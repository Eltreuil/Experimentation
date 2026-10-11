# OpenBIM Studio

Modeleur BIM web inspiré de Revit. Vous dessinez en plan ; le modèle 3D, les élévations et les nomenclatures se mettent à jour automatiquement. Le projet s'exporte en IFC4.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (Vitest)
npm run build      # vérification des types + build de production dans dist/
```

Au premier lancement, une maison R+1 de démonstration est chargée. Le projet est sauvegardé automatiquement dans le navigateur.

## Fonctionnalités

| Domaine | Ce qui est disponible |
|---|---|
| **Modélisation** | Murs (ligne ou rectangle, en chaîne, ligne de justification axe/nu, raccords en angle et en T), portes et fenêtres hébergées dans les murs, poteaux rectangulaires ou circulaires, sols, toits (plat, 1 pan, 2 pans, 4 pans), escaliers droits (calcul des marches et formule de Blondel), quadrillages |
| **Pièces** | Détection automatique en cliquant dans un espace fermé par des murs, ou contour dessiné ; surface et périmètre |
| **Création rapide** | « Sol par murs » et « Toit par murs » (avec débord) à partir de l'emprise des murs |
| **Vues** | Plans d'étage par niveau (plan de coupe à 1,20 m, niveau inférieur en grisé), vue 3D (orbite, styles visuels, arêtes, coupe horizontale), élévations Nord/Sud/Est/Ouest avec repères de niveaux, onglets de vues |
| **Annotation** | Cotes alignées, étiquettes de pièces, repères de portes et fenêtres, cotes temporaires pendant le tracé |
| **Édition** | Sélection (clic, fenêtre, capture), déplacement avec étirement des murs raccordés, poignées d'extrémités et de sommets, copier/coller, rotation, symétrie, annuler/rétablir (200 niveaux) |
| **Accrochage** | Extrémités, milieux, sommets, intersections de quadrillages, point le plus proche, orthogonal (Maj pour forcer, Alt pour désactiver) ; saisie d'une longueur au clavier pendant un tracé |
| **Propriétés** | Paramètres d'occurrence et de type (comme dans Revit), niveaux, unités (mm/cm/m) |
| **Gestion** | Niveaux (ajout, altitude, hauteur, copie des murs extérieurs vers un autre niveau), éditeur de types de murs, de portes et de fenêtres |
| **Nomenclatures** | Murs, portes, fenêtres, pièces et sols, avec totaux et export CSV |
| **Fichiers** | Enregistrer/ouvrir (`.obim.json`), export **IFC4** (murs avec réservations, portes, fenêtres, dalles, toiture en B-rep, poteaux, escaliers, espaces), export **glTF** (`.glb`), export **PNG** de la vue |

## Raccourcis (style Revit, en français)

| Touches | Action | Touches | Action |
|---|---|---|---|
| `MU` | Mur | `PI` | Pièce |
| `PO` | Porte | `CO` | Cote |
| `FE` | Fenêtre | `QU` | Quadrillage |
| `PT` | Poteau | `MO` | Modifier (sélection) |
| `SO` | Sol | `ZE` | Zoom étendu |
| `TO` | Toit | `RO` | Rotation de 90° |
| `ES` | Escalier | `Suppr` | Supprimer |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir | `Ctrl+C` / `Ctrl+V` | Copier / Coller |
| `Ctrl+S` / `Ctrl+O` | Enregistrer / Ouvrir | `Échap`, clic droit | Terminer, puis revenir à la sélection |

En plan : molette pour zoomer, clic milieu ou clic droit glissé pour se déplacer.

## Architecture

```
src/
  model/      Données et calculs purs (sans DOM) : types, géométrie, raccords de murs,
              historique, détection de pièces, maillages 3D, nomenclatures
  io/         Export IFC4 (STEP) et fichiers
  tools/      Outils de dessin du plan (sélection, mur, ouvertures, contours…)
  views/      Plan (Canvas 2D), 3D et élévations (Three.js), nomenclatures
  ui/         Ruban, barre des options, arborescence, propriétés, boîtes de dialogue
  app.ts      État de l'application (vue active, outil, sélection, options)
  commands.ts Commandes (copier, rotation, symétrie, sol/toit par murs, niveaux)
```

Toutes les longueurs sont stockées en mètres. Le modèle (`src/model`) ne dépend ni du DOM ni de Three.js : la même géométrie sert au rendu 3D, aux quantités et à l'export IFC.

## Limites connues

- Les murs ne s'attachent pas encore à la sous-face du toit : avec un toit à 2 pans, les pignons restent ouverts.
- Pas de murs courbes, de familles paramétriques personnalisées, de feuilles de mise en page ni de travail collaboratif.
- L'IFC est exporté, mais aucun fichier IFC ne peut être importé.
