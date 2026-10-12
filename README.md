# OpenBIM Studio

**Modeleur BIM libre et gratuit, inspiré de Revit.** Vous dessinez en plan ; le modèle 3D, les coupes, les élévations, les nomenclatures et les feuilles se mettent à jour automatiquement. Le projet s'échange en **IFC4**, **DXF**, **SVG**, **glTF** et **PNG**.

Fonctionne dans le navigateur, hors ligne (application installable), et en **application de bureau** pour Windows, macOS et Linux.

Licence **MIT** : utilisez-le, modifiez-le, partagez-le.

## Installer

| Plateforme | Comment |
|---|---|
| **Windows / macOS / Linux** | Téléchargez l'installateur dans les [Releases](../../releases) : `.exe` (installation ou portable), `.dmg`, `.AppImage` ou `.tar.gz`. |
| **Navigateur** | Ouvrez la version publiée sur GitHub Pages, puis « Installer l'application » dans la barre d'adresse pour l'utiliser hors ligne. |
| **Depuis les sources** | `npm install && npm run dev`, puis ouvrez http://localhost:5173 |

Pour construire vous-même l'exécutable de bureau :

```bash
npm install
npm run build
cd desktop
npm install
npm run dist         # installateurs pour le système courant, dans desktop/release/
```

## Fonctionnalités

### Modélisation (onglet Architecture)
- **Murs** : en ligne ou en rectangle, en chaîne, ligne de justification (axe ou nu). Les raccords en angle, en T et les jonctions multiples sont nettoyés automatiquement.
  - **Contrainte supérieure** : la hauteur peut suivre un niveau, avec un décalage.
  - **Attacher haut** : le haut du mur peut suivre la sous-face d'un toit (pignons fermés).
  - **Murs-rideaux** : meneaux, traverses et vitrage.
- **Portes, fenêtres et ouvertures** : hébergées dans les murs, avec inversion du sens et de l'ouverture.
- **Sols** (dessinés ou générés depuis les murs) et **trémies** qui percent les sols.
- **Toits** plats, à 1, 2 ou 4 pans (croupe), dessinés ou générés depuis les murs avec débord.
- **Faux-plafonds** : clic dans une pièce ou contour dessiné.
- **Escaliers droits** (calcul des marches et formule de Blondel), **garde-corps**, **poteaux**.
- **Composants** : mobilier (lits, canapé, tables, bureau, armoire), sanitaires (WC, lavabo, baignoire, douche), cuisine, équipements, arbres, voiture.
- **Pièces délimitées** : un clic dans un espace fermé crée la pièce. Son contour suit ensuite automatiquement les murs, et la pièce signale quand elle n'est plus fermée.
- **Quadrillages** et **niveaux**.

### Familles paramétriques (`FA`)
Système de familles comparable aux familles chargeables de Revit :
- **Paramètres** de type ou d'occurrence : longueur, nombre, entier, angle, oui/non, matériau, texte.
- **Formules** : `Longueur / 2`, `if([Avec chaises]; 6; 0)`, `max(1; rounddown(Longueur / 60 cm))`.
  - Opérateurs : `+ − × / ^ %`, comparaisons, `et`, `ou`, `non`.
  - Fonctions : `min`, `max`, `round`, `rounddown`, `roundup`, `sqrt`, `sin`, `cos`…
  - Unités `mm`, `cm`, `m`, `°`. Les noms avec espaces s'écrivent entre crochets.
  - L'éditeur détecte les références circulaires.
- **Types** : jeux de valeurs nommés (par ex. « 180 × 90 », « 240 × 100 »). Modifier un type met à jour toutes ses occurrences.
- **Géométrie paramétrique** : boîtes et cylindres dont chaque cote est une formule.
  - Visibilité conditionnelle.
  - Répétitions : un nombre d'exemplaires avec un pas, la variable `i` vaut 0, 1, 2… Les chaises se répartissent ainsi automatiquement le long d'une table.
  - Matériaux pilotés par paramètre, vitrage.
- **Symboles 2D** paramétriques pour le plan, ou contour automatique des volumes.
- **Éditeur de familles** avec aperçu plan et 3D en direct, duplication, import/export de fichiers `.ofam.json`, placement direct dans le projet.
- **Bibliothèque fournie** : table avec chaises automatiques, lit avec chevets, linéaire de cuisine (caissons, évier, plaque), étagère à tablettes, et une vingtaine de familles de mobilier, sanitaires et équipements.

### Murs composites et quantitatifs
- Structure des types de mur en **couches** (« Modifier la structure ») : finition, isolation, structure, membrane, lame d'air. L'épaisseur suit les couches.
- Couches dessinées en plan selon le niveau de zoom (hachures de structure, motif d'isolant).
- **Quantitatif des matériaux** : surfaces et volumes par matériau, ouvertures déduites.
- Export IFC des couches (`IfcMaterialLayerSet`).

### Phases (réhabilitation)
- Phases du projet (Existant, Nouvelle construction…). Chaque élément a une phase de création et éventuellement une phase de démolition.
- Chaque vue a une **phase** et un **filtre de phase** :
  - afficher complet ;
  - afficher tout, avec existant en gris, démoli en jaune pointillé et neuf en rouge ;
  - état projeté, démolitions, état existant, nouveau uniquement.
- Outil **Démolir** (`DM`) : les portes et fenêtres hébergées sont démolies avec leur mur.
- Pièces délimitées par les murs présents dans leur phase. Colonne Phase dans les nomenclatures.

### Fond de plan et dessin 2D
- **Importer CAO** (onglet Insérer) : fichiers DXF avec lignes, polylignes, arcs, cercles, ellipses, textes et blocs. Unités détectées ou choisies, positionnement à l'origine ou au centre. Les extrémités et les segments sont **accrochables** pour redessiner un plan existant.
- **Lignes de détail** (`LD`) : styles fin, moyen, épais, tirets, caché, axe.
- **Zones remplies** (`ZR`) : hachures, béton, isolant, terre, plein.

### Modification (onglet Modifier)
- Aligner, Décaler, Déplacer, Copier (multiple), Rotation (angle saisi ou cliqué, accrochage à 15°), Symétrie (avec ou sans copie), Réseau linéaire.
- Ajuster/prolonger pour former un angle, Prolonger jusqu'à une limite, Scinder.
- Poignées d'extrémités et de sommets ; les murs raccordés s'étirent pour rester joints.
- Copier/coller, **copier vers d'autres niveaux**, **sélectionner toutes les occurrences** du même type (`TS`), annuler/rétablir sur 200 niveaux.
- **Menu contextuel** au clic droit en plan.
- **Cotes temporaires modifiables** : cliquez la valeur affichée sur un mur sélectionné (longueur) ou une porte/fenêtre (distances aux extrémités) et tapez la nouvelle cote.
- **Épingler** (`PN` / `UP`) : un élément épinglé ne peut être ni déplacé ni supprimé.
- **Masquer / isoler temporairement** (`HH` / `HI`, `HR` pour réinitialiser), vue par vue.
- Les cloisons raccordées en T suivent le mur que l'on déplace.

### Saisie précise
- Accrochage aux extrémités, milieux, sommets, centres, intersections de quadrillages, au point le plus proche et en orthogonal.
- `Maj` force l'orthogonalité, `Alt` désactive l'accrochage.
- Pendant un tracé, tapez une longueur au clavier (`450`, `4.5m`, `3200mm`) puis `Entrée`.
- Cotes temporaires pendant le dessin ; outil **Mesurer** (segments, total, ΔX/ΔY, angle).

### Annotation
- Cotes alignées et **cotes de mur en chaîne** (extrémités et ouvertures en un clic).
- Textes, étiquettes de pièces (nom, numéro, surface), repères de portes et fenêtres.

### Vues
- **Plans d'étage** : plan de coupe à 1,20 m, niveau inférieur en grisé, échelle de vue (1/20 à 1/500).
- **Vue 3D** : orbite, styles visuels, arêtes, ombres, coupe horizontale.
- **Coupes** : vues coupées avec remplissage des parties coupées (poché), rognées sur la ligne de coupe et sa profondeur.
- **Élévations** Nord, Sud, Est et Ouest, avec repères de niveaux. Les **repères d'élévation** apparaissent en plan ; un double-clic ouvre la vue.
- **Visibilité/Graphismes** (`VG`) : afficher ou masquer chaque catégorie, vue par vue.

### Nomenclatures
Murs (longueur, surface nette, volume), portes, fenêtres, pièces, sols, composants (par famille et type) et quantitatif des matériaux, avec totaux et export CSV.

### Feuilles et exports
- **Feuille A3** avec cartouche : projet, maître d'ouvrage, auteur, phase, échelle, date, nord, échelle graphique. Impression directe (ou PDF) et export SVG vectoriel.
- **DXF** (AutoCAD R12, en mm) avec un calque par catégorie : MURS, PORTES, COTES…
- **IFC4** : niveaux, murs avec réservations, murs-rideaux, portes, fenêtres, dalles percées, toitures, poteaux, escaliers, garde-corps, plafonds, mobilier, sanitaires et espaces. Validé avec IfcOpenShell : 0 erreur de schéma.
- **glTF** (`.glb`) pour la visualisation ou les moteurs 3D, et **PNG** de la vue.

## Raccourcis clavier (style Revit, en français)

| Touches | Action | Touches | Action |
|---|---|---|---|
| `MU` `PO` `FE` | Mur, porte, fenêtre | `ME` | Mesurer |
| `OU` `TR` | Ouverture, trémie | `AL` `DE` | Aligner, décaler |
| `CP` `PT` | Composant, poteau | `AJ` `PR` `SC` | Angle, prolonger, scinder |
| `SO` `TO` `FP` | Sol, toit, faux-plafond | `DP` `CC` `RO` | Déplacer, copier, rotation |
| `ES` `GC` | Escalier, garde-corps | `SY` `RS` | Symétrie, réseau |
| `PI` `QU` | Pièce, quadrillage | `AH` | Attacher le haut des murs |
| `CO` `CM` | Cote, cotes de mur | `VG` `ZE` | Visibilité, zoom étendu |
| `TX` `CE` | Texte, coupe | `MO` | Modifier (sélection) |
| `FA` | Éditeur de familles | `TS` | Sélectionner le même type |
| `DM` | Démolir | `HH` `HI` `HR` | Masquer, isoler, réinitialiser |
| `LD` `ZR` | Ligne de détail, zone remplie | `PN` `UP` | Épingler, désépingler |

À cela s'ajoutent `Ctrl+Z`/`Ctrl+Y`, `Ctrl+C`/`Ctrl+V`, `Ctrl+A`, `Ctrl+S`/`Ctrl+O` et `Suppr`. `Échap` ou un clic droit termine la saisie en cours. En plan, la molette zoome et le clic milieu déplace la vue.

## Architecture

```
src/
  model/      Cœur BIM sans DOM : types, géométrie, raccords de murs, historique,
              contraintes, détection de pièces, maillages 3D, toits, opérations
              de modification (edit.ts), formules (expr.ts), familles
              paramétriques (family.ts, familyLibrary.ts), nomenclatures,
              signatures pour la 3D incrémentale (signature.ts)
  io/         IFC4 (STEP), SVG/DXF/feuilles (vector.ts), fichiers projet
  tools/      Outils interactifs du plan : création (draw.ts), modification
              (modify.ts), sélection (select.ts)
  views/      Plan (Canvas 2D), 3D/élévations/coupes (Three.js), nomenclatures
  ui/         Ruban, barre des options, arborescence, propriétés, dialogues
desktop/      Application de bureau Electron et configuration des installateurs
.github/      CI (tests + build), publication GitHub Pages, releases multiplateformes
```

Toutes les longueurs sont stockées en mètres. La vue 3D ne reconstruit que les éléments dont la géométrie a changé, et les raccords de murs utilisent un index spatial. La même géométrie sert au rendu 3D, aux quantités, aux exports et à l'IFC. Pour automatiser l'application, `window.openbim` donne accès à l'application depuis la console.

## Contribuer

Les contributions sont les bienvenues ; voir [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` lance les tests unitaires (géométrie, raccords, contraintes, outils de modification, nomenclatures, IFC).

## Limites connues

- Les murs sont droits uniquement (pas de murs courbes).
- Les portes et fenêtres utilisent des types simples (largeur, hauteur, allège), pas encore des familles paramétriques.
- L'IFC est seulement exporté, pas importé. Le DXF s'importe en fond de plan 2D.
- Pas de travail collaboratif en temps réel.
