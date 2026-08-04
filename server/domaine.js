'use strict';

/*
 * Les regles metier sont ecrites une seule fois, dans public/js/regles.js, et
 * partagees telles quelles entre le navigateur et le serveur. Les totaux et les
 * controles affiches au chef d'equipe sont donc rigoureusement ceux appliques a
 * la reception de la fiche : aucune divergence possible entre les deux.
 */

module.exports = require('../public/js/regles.js');
