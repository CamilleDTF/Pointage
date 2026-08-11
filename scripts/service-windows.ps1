# Installe l'application en service Windows : elle demarre avec la machine,
# tourne sans session ouverte, et repart toute seule apres un plantage.
#
#   Clic droit sur INSTALLER-SERVICE.bat > "Exécuter en tant qu'administrateur"
#   ou, dans une console PowerShell d'administrateur :
#       .\scripts\service-windows.ps1 -Action installer
#
# Pourquoi ce script plutot que DEMARRER.bat : DEMARRER.bat est fait pour un
# poste ou quelqu'un est assis. Il installe les composants, ouvre le navigateur,
# et surtout il tient l'application dans sa fenetre — fermer la fenetre, ou
# simplement se deconnecter du serveur, arrete tout. Sur un serveur, c'est
# exactement ce qu'il ne faut pas.
#
# Relançable sans risque : le service existant est remplace, les donnees deja
# saisies sont conservees.

param(
    [ValidateSet('installer', 'desinstaller', 'etat')]
    [string]$Action = 'installer',
    [int]$Port = 3000,
    # Le pare-feu de Windows bloque le port par defaut : sans cette regle,
    # l'application ne repond qu'a elle-meme. A ne pas ouvrir si un proxy
    # (Tailscale, IIS, Caddy) se charge deja de la joindre.
    [switch]$SansPareFeu
)

$ErrorActionPreference = 'Stop'

$Racine  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Service = 'Pointage'
$Journal = Join-Path $Racine 'data\service.log'

function Dire($texte, $couleur = 'Gray') { Write-Host "  $texte" -ForegroundColor $couleur }
function Titre($texte) { Write-Host ""; Write-Host "  $texte" -ForegroundColor Cyan; Write-Host "" }

function Abandonner($texte) {
    Write-Host ""
    Write-Host "  $texte" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Appuyez sur Entrée pour fermer"
    exit 1
}

function ExigerAdministrateur {
    $moi = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $moi.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Abandonner "Ce script doit être lancé en tant qu'administrateur (clic droit sur INSTALLER-SERVICE.bat > « Exécuter en tant qu'administrateur »)."
    }
}

<#
 Le chemin complet de node.exe, et non « node ».

 Un service ne tourne pas sous votre compte : il tourne sous le compte Systeme,
 qui n'a ni votre PATH ni vos variables. « node » y est introuvable, et le
 service echoue au demarrage avec un message qui ne dit pas pourquoi. On resout
 donc le chemin maintenant, pendant qu'on est encore dans votre session.

 Meme raison pour le refus d'une installation par utilisateur (fnm, nvm, un
 dossier sous AppData) : elle marche pour vous et pour personne d'autre.
#>
function TrouverNode {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        Abandonner "Node.js est introuvable. Installez-le depuis https://nodejs.org (version 22 ou plus, le gros bouton « LTS »), puis relancez ce script."
    }
    $chemin = $node.Source

    $version = [int](& $chemin -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
    if ($version -lt 22) {
        Abandonner "Node.js $version détecté, version 22 ou plus requise. Mettez à jour depuis https://nodejs.org, puis relancez ce script."
    }

    foreach ($prive in @($env:LOCALAPPDATA, $env:APPDATA, $env:USERPROFILE)) {
        if ($prive -and $chemin.StartsWith($prive, 'OrdinalIgnoreCase')) {
            Abandonner @"
Node.js est installé pour votre compte seulement :
    $chemin
Le compte Système, qui fera tourner le service, ne le verra pas.
Réinstallez Node.js depuis https://nodejs.org avec l'installateur .msi, qui
l'installe pour toute la machine (C:\Program Files\nodejs), puis relancez.
"@
        }
    }
    return $chemin
}

function PreparerApplication($node) {
    Push-Location $Racine
    try {
        & $node scripts/verifier-composants.js *> $null
        if ($LASTEXITCODE -ne 0) {
            Dire "Installation des composants (comptez une à deux minutes)…"
            & npm install --no-audit --no-fund
        }
        & $node scripts/verifier-composants.js *> $null
        if ($LASTEXITCODE -ne 0) {
            Abandonner "L'installation des composants a échoué. Lancez REINSTALLER.bat : il repart de zéro et écrit la réponse exacte de npm dans installation.txt."
        }
        Dire "Composants : en place." 'Green'

        if (-not (Test-Path (Join-Path $Racine 'data\pointage.db'))) {
            Dire "Première installation : création du compte directeur…"
            & $node scripts/creer-compte.js --nom "Direction" --identifiant directeur --code 246810 --role directeur
        }
    } finally {
        Pop-Location
    }
}

<#
 NSSM — l'enveloppe qui fait d'un programme ordinaire un vrai service.

 Windows ne sait pas piloter n'importe quel exécutable en service : il attend
 un programme qui sache lui répondre. node.exe ne le sait pas, et un `sc create`
 pointé droit dessus donne le fameux « le service n'a pas répondu à temps »
 (erreur 1053). NSSM fait l'intermédiaire : il répond à Windows, et surveille
 node de son côté.

 Il n'est pas indispensable : sans lui, on retombe sur le planificateur de
 tâches, livré avec Windows. Le service est plus propre — il apparaît dans
 services.msc, se pilote avec « net start », et journalise sa sortie.
#>
function ObtenirNssm {
    $outils = Join-Path $Racine 'outils'
    $nssm = Join-Path $outils 'nssm.exe'
    if (Test-Path $nssm) { return $nssm }

    $installe = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($installe) { return $installe.Source }

    Dire "Téléchargement de NSSM (300 Ko)…"
    $zip = Join-Path $env:TEMP 'nssm.zip'
    $temporaire = Join-Path $env:TEMP 'nssm-extrait'
    try {
        Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing -TimeoutSec 60
        if (Test-Path $temporaire) { Remove-Item $temporaire -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $temporaire -Force
        $dossier = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
        $source = Get-ChildItem $temporaire -Recurse -Filter nssm.exe |
                  Where-Object { $_.DirectoryName -like "*$dossier" } |
                  Select-Object -First 1
        if (-not $source) { throw "nssm.exe absent de l'archive." }
        New-Item -ItemType Directory -Force -Path $outils | Out-Null
        Copy-Item $source.FullName $nssm -Force
        return $nssm
    } catch {
        Dire "Téléchargement impossible : $($_.Exception.Message)" 'Yellow'
        return $null
    } finally {
        Remove-Item $zip, $temporaire -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function ServiceExistant { [bool](Get-Service -Name $Service -ErrorAction SilentlyContinue) }
function TacheExistante { [bool](Get-ScheduledTask -TaskName $Service -ErrorAction SilentlyContinue) }

function InstallerServiceNssm($nssm, $node) {
    if (ServiceExistant) {
        Dire "Remplacement du service existant…"
        & $nssm stop $Service *> $null
        & $nssm remove $Service confirm *> $null
        Start-Sleep -Seconds 2
    }

    & $nssm install $Service $node 'server\index.js' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "NSSM n'a pas pu créer le service (code $LASTEXITCODE)." }

    & $nssm set $Service AppDirectory $Racine                        | Out-Null
    & $nssm set $Service DisplayName 'Pointage hebdomadaire'         | Out-Null
    & $nssm set $Service Description "Saisie des fiches de pointage. Interface web sur le port $Port." | Out-Null
    & $nssm set $Service Start SERVICE_AUTO_START                    | Out-Null
    & $nssm set $Service AppEnvironmentExtra "NODE_ENV=production" "PORT=$Port" | Out-Null

    # Sans redirection, tout ce que l'application écrit est perdu : le jour où
    # elle refuse de démarrer, il ne resterait qu'un code d'erreur.
    & $nssm set $Service AppStdout $Journal        | Out-Null
    & $nssm set $Service AppStderr $Journal        | Out-Null
    & $nssm set $Service AppRotateFiles 1          | Out-Null
    & $nssm set $Service AppRotateBytes 5242880    | Out-Null

    & $nssm set $Service AppExit Default Restart   | Out-Null
    & $nssm set $Service AppRestartDelay 5000      | Out-Null
    # Ctrl+C avant la hache : l'application ferme sa base proprement.
    & $nssm set $Service AppStopMethodConsole 8000 | Out-Null

    & $nssm start $Service | Out-Null
    return 'service'
}

function InstallerTachePlanifiee($node) {
    # Le planificateur ne sait pas poser de variables d'environnement : ce petit
    # lanceur s'en charge, et evite d'aller les inscrire pour toute la machine.
    $lanceur = Join-Path $Racine 'scripts\service-lancer.cmd'
    @"
@echo off
rem Lanceur du service. Ecrit par scripts\service-windows.ps1 — ne pas modifier
rem a la main : il est reecrit a chaque installation.
cd /d "%~dp0.."
set NODE_ENV=production
set PORT=$Port
"$node" server\index.js >> "data\service.log" 2>&1
"@ | Set-Content -Path $lanceur -Encoding ASCII

    if (TacheExistante) { Unregister-ScheduledTask -TaskName $Service -Confirm:$false }

    $action = New-ScheduledTaskAction -Execute $lanceur -WorkingDirectory $Racine
    $declencheur = New-ScheduledTaskTrigger -AtStartup
    $compte = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $reglages = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $Service -Action $action -Trigger $declencheur `
        -Principal $compte -Settings $reglages `
        -Description 'Saisie des fiches de pointage.' | Out-Null
    Start-ScheduledTask -TaskName $Service
    return 'tache'
}

function OuvrirPareFeu {
    $nom = "Pointage (port $Port)"
    Get-NetFirewallRule -DisplayName $nom -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $nom -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Domain, Private | Out-Null
    Dire "Pare-feu : port $Port ouvert sur les réseaux d'entreprise et privés." 'Green'
}

<#
 Verifier que l'application repond, et non que le service est « demarre ».

 Un service peut etre marque demarre alors que node vient de sortir en erreur :
 c'est la difference entre « Windows a lance le programme » et « l'application
 fonctionne ». Seule une vraie requete tranche.
#>
function AttendreReponse($essais = 20) {
    for ($essai = 1; $essai -le $essais; $essai++) {
        Start-Sleep -Seconds 1
        try {
            $reponse = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
            if ($reponse.StatusCode -eq 200) { return $true }
        } catch { }
    }
    return $false
}

function Installer {
    Titre "Installation du service Pointage"
    $node = TrouverNode
    Dire "Node.js : $node" 'Green'
    PreparerApplication $node

    $nssm = ObtenirNssm
    $mode = if ($nssm) {
        InstallerServiceNssm $nssm $node
    } else {
        Dire "Repli sur le planificateur de tâches, livré avec Windows." 'Yellow'
        InstallerTachePlanifiee $node
    }

    if (-not $SansPareFeu) { OuvrirPareFeu }

    if (AttendreReponse) {
        $nom = (Get-CimInstance Win32_ComputerSystem).Name
        Write-Host ""
        Dire "============================================================" 'Green'
        Dire "  L'application tourne." 'Green'
        Dire ""
        Dire "  Depuis ce serveur   http://localhost:$Port"
        Dire "  Depuis le réseau    http://$nom`:$Port"
        Dire "  Identifiant         directeur"
        Dire "  Code                246810   (à changer à la première connexion)"
        Dire ""
        if ($mode -eq 'service') {
            Dire "  Elle redémarre avec le serveur, et repart seule après un"
            Dire "  plantage. Vous la retrouvez dans services.msc sous"
            Dire "  « Pointage hebdomadaire », ou avec :"
            Dire "      net stop Pointage   /   net start Pointage"
        } else {
            Dire "  Elle redémarre avec le serveur. Vous la retrouvez dans le"
            Dire "  Planificateur de tâches sous « Pointage »."
        }
        Dire ""
        Dire "  Journal             data\service.log"
        Dire "============================================================" 'Green'
        Write-Host ""
        Write-Host "  Reste à la rendre joignable en HTTPS depuis les chantiers :" -ForegroundColor Yellow
        Write-Host "  voir docs\DEPLOIEMENT.md, section « Windows Server »." -ForegroundColor Yellow
    } else {
        Write-Host ""
        Dire "Le service est installé mais l'application ne répond pas sur le port $Port." 'Red'
        Dire "Le détail est dans $Journal" 'Red'
        if (Test-Path $Journal) { Write-Host ""; Get-Content $Journal -Tail 20 }
    }
    Write-Host ""
    Read-Host "  Appuyez sur Entrée pour fermer"
}

function Desinstaller {
    Titre "Retrait du service Pointage"
    # Les données ne sont pas touchées : elles vivent dans data\, que ce script
    # n'efface jamais. Réinstaller le service les retrouve telles quelles.
    if (ServiceExistant) {
        $nssm = ObtenirNssm
        if ($nssm) { & $nssm stop $Service *> $null; & $nssm remove $Service confirm *> $null }
        else { & sc.exe stop $Service *> $null; & sc.exe delete $Service *> $null }
        Dire "Service retiré." 'Green'
    }
    if (TacheExistante) {
        Stop-ScheduledTask -TaskName $Service -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $Service -Confirm:$false
        Dire "Tâche planifiée retirée." 'Green'
    }
    Get-NetFirewallRule -DisplayName "Pointage (port*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Dire "Vos données restent dans $Racine\data — rien n'a été effacé." 'Green'
    Write-Host ""
    Read-Host "  Appuyez sur Entrée pour fermer"
}

function Etat {
    Titre "État du service Pointage"
    if (ServiceExistant) {
        $s = Get-Service -Name $Service
        Dire "Service     : $($s.Status) (démarrage $((Get-CimInstance Win32_Service -Filter "Name='$Service'").StartMode))"
    } elseif (TacheExistante) {
        Dire "Tâche       : $((Get-ScheduledTask -TaskName $Service).State)"
    } else {
        Dire "Ni service ni tâche : l'application n'est pas installée." 'Yellow'
    }
    Dire ("Réponse     : " + $(if (AttendreReponse 2) { "http://localhost:$Port répond." } else { "aucune réponse sur le port $Port." }))
    if (Test-Path $Journal) {
        Write-Host ""
        Dire "Vingt dernières lignes du journal :"
        Get-Content $Journal -Tail 20
    }
    Write-Host ""
    Read-Host "  Appuyez sur Entrée pour fermer"
}

ExigerAdministrateur
switch ($Action) {
    'installer'    { Installer }
    'desinstaller' { Desinstaller }
    'etat'         { Etat }
}
