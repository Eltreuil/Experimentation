# Contribuer à OpenBIM Studio

Merci de votre intérêt ! Toute contribution est la bienvenue : signalement de bugs, idées, traductions, code, documentation.

## Mettre en place l'environnement

```bash
git clone https://github.com/Eltreuil/Experimentation.git openbim-studio
cd openbim-studio
npm install
npm run dev      # application sur http://localhost:5173
npm test         # tests unitaires
npm run build    # vérification des types + build de production
```

Application de bureau (Electron) :

```bash
npm run build
cd desktop && npm install && npm start
```

## Organisation du code

- `src/model/` : le cœur BIM, **sans dépendance au DOM** (types, géométrie, raccords, maillages, nomenclatures). C'est ici que se trouve la logique à tester en priorité.
- `src/tools/` : les outils interactifs de la vue en plan (un fichier par famille d'outils).
- `src/views/` : rendus (plan en Canvas 2D, 3D/élévations/coupes avec Three.js, nomenclatures).
- `src/ui/` : interface (ruban, propriétés, arborescence, dialogues).
- `src/io/` : formats d'échange (IFC4, SVG, DXF, fichiers projet).

## Règles

1. Toute modification du modèle passe par `project.transact(label, fn)` pour rester annulable.
2. Les longueurs sont stockées en **mètres** ; l'affichage passe par `formatLength` / `parseLength`.
3. Ajoutez un test dans `tests/` pour toute nouvelle logique de `src/model` ou `src/io`.
4. `npm test` et `npm run build` doivent passer avant d'ouvrir une pull request (la CI le vérifie).
5. L'interface est en français ; gardez des libellés proches de ceux de Revit en français.

## Publier une version

Poussez un tag `vX.Y.Z` : la CI construit les exécutables Windows, macOS et Linux et les attache à la release GitHub.
