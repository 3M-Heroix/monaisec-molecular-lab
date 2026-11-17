import { ConformerGenerator, Molecule, Resources } from './vendor/ocl/openchemlib.mjs';

self.addEventListener('message', async ({ data: smiles }) => {
  try {
    let molecule;
    try {
      molecule = Molecule.fromSmiles(smiles);
    } catch {
      throw new Error('Ce SMILES n’a pas pu être interprété.');
    }
    const atomCount = molecule.getAllAtoms();
    if (atomCount < 1 || atomCount > 70 || molecule.getFragments().length !== 1) {
      throw new Error('Utilise le SMILES d’une seule molécule, de 1 à 70 atomes avant ajout des hydrogènes.');
    }
    await Resources.registerFromUrl();
    const conformer = new ConformerGenerator(20261117).getOneConformerAsMolecule(molecule);
    if (!conformer) throw new Error('OpenChemLib n’a pas trouvé de conformère pour cette structure.');
    self.postMessage({ sdf: conformer.toMolfile() + '\n$$$$\n' });
  } catch (error) {
    self.postMessage({ error: error.message || 'Le calcul du conformère a échoué.' });
  }
});
