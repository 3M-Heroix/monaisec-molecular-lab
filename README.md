# Monaisec Molecular Lab

Vitrine indépendante en français. Le site est statique, avec cinq pages dans `dist/` et des ressources locales. Les six petites molécules et les deux complexes sont disponibles sans requête PubChem en direct. La recherche de composés externes utilise l’API PUG REST de PubChem. La génération d’un conformère à partir d’un SMILES tourne dans le navigateur, avec OpenChemLib et une graine fixe. Les imports restent côté navigateur.

## Aperçu local

Depuis le dossier extrait, lancez `python3 -m http.server 8000 --directory dist` et ouvrez `http://localhost:8000`. Sous Windows, remplacez `python3` par `py` si nécessaire. Le serveur HTTP permet de charger les structures locales et le module de génération.

## Déploiement sur le dépôt dédié

1. Placez ce README et `dist/` dans le dépôt du Molecular Lab.
2. Créez un projet Cloudflare Pages séparé et connectez ce dépôt. Sélectionnez la branche de production, laissez la commande de build vide et définissez `dist` comme répertoire de sortie.
3. Validez les pages sur l’URL fournie par Pages, puis ajoutez `lab.monaisec.com` dans les domaines personnalisés du projet. Confirmez le CNAME proposé par Cloudflare et attendez que le certificat HTTPS soit actif.

Documentation [intégration Git](https://developers.cloudflare.com/pages/get-started/git-integration/) et [sous-domaines](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Audit ChEMBL de la MMP-1

La [note de recherche](https://lab.monaisec.com/mmp1-benchmark.html) présente les résultats d’inventaire et le protocole d’évaluation proposé. Le [snapshot JSON](dist/assets/research/mmp1-audit-v1.json) conserve les effectifs et la provenance. Pour recalculer l’audit tant que l’API sert ChEMBL 37, exécutez `python3 research/audit_mmp1.py --release ChEMBL_37`. Le script utilise la bibliothèque standard de Python.

## Sources et composants

- Les structures SDF proviennent de PubChem, conformères 3D des CID 936, 338, 54670067, 753, 2519 et 1176. Les visuels éditoriaux sont calculés à partir des coordonnées des CID 54670067 et 338.
- Les fichiers PDB proviennent du RCSB PDB. Références [1HFC](https://doi.org/10.2210/pdb1HFC/pdb) et [1CGL](https://doi.org/10.2210/pdb1CGL/pdb). Le site actif de l’atelier montre la chaîne A. Les distances affichées sont calculées à partir des coordonnées des atomes.
- 3Dmol.js 2.5.3, OpenChemLib 9.23.0 et les polices locales sont distribués avec leurs licences dans `dist/assets/vendor/`.
- La génération locale produit une géométrie calculée d’une molécule isolée. Les calculs de docking et l’évaluation sur MMP‑1 constituent le programme de recherche présenté sur le site.
