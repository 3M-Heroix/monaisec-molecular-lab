(() => {
  const pubchem = 'https://pubchem.ncbi.nlm.nih.gov';
  const molecules = [
    ['936', 'Niacinamide', 'C₆H₆N₂O'],
    ['338', 'Acide salicylique', 'C₇H₆O₃'],
    ['54670067', 'Acide L-ascorbique', 'C₆H₈O₆'],
    ['753', 'Glycérine', 'C₃H₈O₃'],
    ['2519', 'Caféine', 'C₈H₁₀N₄O₂'],
    ['1176', 'Urée', 'CH₄N₂O'],
  ].map(([id, title, formula]) => ({
    id, title, formula, format: 'sdf',
    source: pubchem + '/compound/' + id,
    local: 'assets/structures/' + id + '.sdf',
    type: 'Conformère calculé · PubChem',
  }));
  const crystals = [
    ['1HFC', 'PLH', 275, ['O1', 'O2']],
    ['1CGL', '0ED', 301, ['OE2', 'OE1']],
  ].map(([id, ligand, zinc, donors]) => ({
    id, title: 'MMP‑1 + ' + ligand, formula: id, format: 'pdb',
    source: 'https://www.rcsb.org/structure/' + id,
    local: 'assets/structures/' + id + '.pdb',
    type: 'Structure expérimentale · RCSB PDB',
    ligand, zinc, donors,
  }));
  const available = new Map([...molecules, ...crystals].map(entry => [entry.id, entry]));
  const aliases = {
    niacinamide: '936', nicotinamide: '936', 'acide salicylique': '338',
    'acide ascorbique': '54670067', 'vitamine c': '54670067',
    'glycérine': '753', 'caféine': '2519', 'urée': '1176',
  };
  const formatAliases = { sdf: 'sdf', mol: 'sdf', pdb: 'pdb', mmcif: 'cif', cif: 'cif', xyz: 'xyz' };
  const atomColors = { H: '#f3f7ff', C: '#78cfd5', O: '#f774a9', N: '#85a7ff', S: '#ffe391', P: '#ffac77', Zn: '#fff7ad' };

  const get = id => document.getElementById(id);
  const canvas = get('molecular-canvas');
  const status = get('viewer-status');
  const styleButtons = get('view-styles');
  const source = get('structure-source');
  const rotate = get('rotate');
  const reset = get('reset-view');
  const download = get('download-structure');
  const searchStatus = get('search-status');
  const conformerStatus = get('conformer-status');
  const entries = new Map();
  let viewer, model, current, modelText, currentStyle;
  let request = 0;
  let spinning = false;
  let cancelGeneration;

  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (probe) probe.getExtension('WEBGL_lose_context')?.loseContext();
    try {
      viewer = probe ? window.$3Dmol.createViewer(canvas, { backgroundColor: '#0a141a', antialias: true }) : null;
    } catch {
      viewer = null;
    }
    viewer ??= new window.MolecularCanvas(canvas);
    new ResizeObserver(() => {
      viewer.resize();
      viewer.render();
    }).observe(canvas);
  } catch {
    setStatus('La visionneuse ne peut pas démarrer. Les pages sources restent disponibles depuis la bibliothèque.');
  }

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
    [rotate, reset, download].forEach(button => { button.disabled = !model; });
  }

  function nameFor(entry) {
    return entry.title + (entry.formula ? ' · ' + entry.formula : '');
  }

  function drawList(list, parent) {
    for (const entry of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.structure = entry.id;
      button.setAttribute('aria-pressed', 'false');
      const label = document.createElement('span');
      label.textContent = entry.title;
      const detail = document.createElement('small');
      detail.textContent = entry.formula;
      button.append(label, detail);
      button.addEventListener('click', () => {
        if (!viewer) return window.open(entry.source, '_blank', 'noopener');
        void loadLocal(entry);
      });
      parent.append(button);
      entries.set(entry.id, button);
    }
  }

  function stopSpin() {
    viewer.spin(false);
    spinning = false;
    rotate.setAttribute('aria-pressed', 'false');
  }

  function startRequest(message) {
    request += 1;
    if (cancelGeneration) cancelGeneration();
    searchStatus.textContent = '';
    conformerStatus.textContent = '';
    setStatus(message);
    return request;
  }

  async function fetchData(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) throw new Error('not-found');
    if (!response.ok) throw new Error('http-' + response.status);
    return response;
  }

  function present(entry, text) {
    if (!viewer) return;
    const previous = model;
    const next = viewer.addModel(text, entry.format, { keepH: true });
    const atoms = next.selectedAtoms({});
    if (!atoms.length || atoms.length > 25000 || atoms.some(atom =>
      !Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z))) {
      viewer.removeModel(next);
      throw new Error('Le fichier doit contenir entre 1 et 25 000 atomes avec des coordonnées valides.');
    }
    if (previous) viewer.removeModel(previous);
    model = next;
    current = entry;
    modelText = text;
    stopSpin();
    get('structure-type').textContent = entry.type;
    get('structure-name').textContent = nameFor(entry);
    source.hidden = !entry.source;
    if (entry.source) source.href = entry.source;
    canvas.setAttribute('aria-label', 'Modèle 3D interactif de ' + entry.title);
    for (const [id, button] of entries) button.setAttribute('aria-pressed', String(entry.id === id));
    styleButtons.replaceChildren();
    const choices = entry.ligand
      ? [['site', 'Site actif'], ['complex', 'Complexe']]
      : entry.format === 'pdb' || entry.format === 'cif'
        ? [['complex', 'Complexe'], ['stick', 'Bâtonnets']]
        : [['ball', 'Boules et bâtonnets'], ['stick', 'Bâtonnets'], ['sphere', 'Sphères']];
    for (const [key, label] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.style = key;
      button.textContent = label;
      button.addEventListener('click', () => drawStyle(key, true));
      styleButtons.append(button);
    }
    drawStyle(choices[0][0], true);
    setStatus('');
  }

  function drawStyle(style, recenter) {
    currentStyle = style;
    for (const button of styleButtons.children) {
      button.setAttribute('aria-pressed', String(button.dataset.style === style));
    }
    get('viewer-contacts').hidden = true;
    viewer.removeAllShapes();
    viewer.removeAllLabels();
    model.setStyle({}, {});
    const palette = { colorscheme: { prop: 'elem', map: atomColors } };
    const stick = { radius: .16, ...palette };
    const ligand = current.ligand ? { chain: 'A', resn: current.ligand } : null;
    if (style === 'site' || style === 'complex') {
      const polymer = ligand ? { chain: 'A', hetflag: false } : { hetflag: false };
      model.setStyle(polymer, { cartoon: { color: style === 'site' ? '#315f6c' : '#5ab6be' } });
      model.setStyle(ligand || { hetflag: true, not: { resn: 'HOH' } }, { stick });
      if (ligand) {
        const histidines = { chain: 'A', resi: [218, 222, 228], resn: 'HIS' };
        if (style === 'site') model.setStyle(histidines, { stick: { radius: .12, color: '#8cc2ce' } }, true);
        const zinc = { chain: 'A', resi: current.zinc, resn: 'ZN' };
        model.setStyle(zinc, { sphere: { radius: .42, color: '#fff7ad' } });
        if (style === 'site') drawContacts(model.selectedAtoms(zinc)[0], model.selectedAtoms(ligand));
      }
    } else if (style === 'sphere') {
      model.setStyle({}, { sphere: { ...palette } });
    } else {
      model.setStyle({}, style === 'ball' ? { stick, sphere: { scale: .29, ...palette } } : { stick });
    }
    if (recenter) resetView();
    else viewer.render();
  }

  function drawContacts(zinc, atoms) {
    if (!zinc) return;
    const contacts = [];
    for (const oxygen of atoms.filter(atom => current.donors.includes(atom.atom.trim()))) {
      const distance = Math.hypot(zinc.x - oxygen.x, zinc.y - oxygen.y, zinc.z - oxygen.z);
      const secondary = current.id === '1CGL' && oxygen.atom.trim() === 'OE1';
      const color = secondary ? '#b6cbd0' : '#fff7ad';
      const label = distance.toFixed(2).replace('.', ',') + ' Å';
      contacts.push({ distance, text: 'Zn–' + oxygen.atom.trim() + ' ' + label });
      viewer.addLine({ start: zinc, end: oxygen, dashed: true, color, dashLength: .13, gapLength: .08 });
      viewer.addLabel(label, {
        position: {
          x: (zinc.x + oxygen.x) / 2,
          y: (zinc.y + oxygen.y) / 2,
          z: (zinc.z + oxygen.z) / 2,
        },
        alignment: 'bottomCenter', backgroundColor: '#1b2a30', fontColor: color,
        fontSize: 13, inFront: true,
      });
    }
    if (contacts.length) {
      const line = get('viewer-contacts');
      line.textContent = contacts.sort((a,b) => a.distance - b.distance).map(contact => contact.text).join(' · ');
      line.hidden = false;
    }
  }

  function resetView() {
    if (!model) return;
    if (currentStyle === 'site') {
      viewer.zoomTo({ chain: 'A', resn: current.ligand });
      viewer.zoom(.8);
    } else if (current.ligand) viewer.zoomTo({ chain: 'A' });
    else viewer.zoomTo();
    viewer.render();
  }

  async function loadLocal(entry) {
    const token = startRequest('Chargement de la structure…');
    try {
      const text = await (await fetchData(entry.local)).text();
      if (token === request) present(entry, text);
    } catch {
      if (token === request) setStatus('La structure n’a pas pu être chargée. Réessaie ou ouvre sa fiche source.');
    }
  }

  async function searchCompound(event) {
    event.preventDefault();
    if (!viewer) {
      searchStatus.textContent = 'La visionneuse n’a pas pu démarrer.';
      return;
    }
    const query = get('compound-query').value.trim();
    if (!query) return;
    const kind = get('search-kind').value;
    const numeric = /^\d+$/.test(query);
    const localId = kind === 'auto' ? aliases[query.toLocaleLowerCase('fr')] || (numeric ? query : '') : '';
    if (localId && available.has(localId)) {
      await loadLocal(available.get(localId));
      return;
    }
    const token = startRequest('Recherche dans PubChem…');
    searchStatus.textContent = 'Recherche en cours…';
    const api = pubchem + '/rest/pug/compound/';
    let cid;
    try {
      if (numeric && kind === 'auto') cid = query;
      else {
        const field = kind === 'smiles' ? 'smiles' : 'name';
        const url = field === 'smiles'
          ? api + 'smiles/cids/JSON?smiles=' + encodeURIComponent(query)
          : api + 'name/' + encodeURIComponent(query) + '/cids/JSON';
        const result = await (await fetchData(url)).json();
        const first = result.IdentifierList?.CID?.[0];
        if (!Number.isSafeInteger(first) || first <= 0) throw new Error('not-found');
        cid = String(first);
      }
      if (token !== request) return;
      const entry = available.get(cid);
      const url = entry?.local || api + 'cid/' + cid + '/SDF?record_type=3d';
      const response = await fetchData(url);
      const text = await response.text();
      if (token !== request) return;
      if (!/\bV(?:2000|3000)\b/.test(text)) throw new Error('invalid-sdf');
      present(entry || {
        id: cid, title: numeric ? 'Composé ' + cid : query,
        formula: 'CID ' + cid, format: 'sdf',
        type: 'Conformère calculé · PubChem', source: pubchem + '/compound/' + cid,
      }, text);
      searchStatus.textContent = 'Conformère chargé · CID ' + cid + '.';
      stageToView();
    } catch (error) {
      if (token !== request) return;
      setStatus(model ? '' : 'Choisis un exemple dans la bibliothèque.');
      searchStatus.textContent = error.message === 'not-found'
        ? 'Composé ou conformère 3D introuvable. Vérifie la requête ou essaie un autre CID.'
        : 'PubChem n’a pas pu fournir de modèle. Réessaie ou choisis un exemple local.';
    }
  }

  function stageToView() {
    const stage = canvas.closest('.stage');
    if (stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function generate(event) {
    event.preventDefault();
    if (!viewer) {
      conformerStatus.textContent = 'La visionneuse n’a pas pu démarrer.';
      return;
    }
    const smiles = get('conformer-query').value.trim();
    if (!smiles) return;
    const token = startRequest('Calcul du conformère…');
    conformerStatus.textContent = 'Calcul du conformère…';
    const submit = event.currentTarget.querySelector('button');
    let worker;
    let timer;
    function finish() {
      clearTimeout(timer);
      worker?.terminate();
      submit.disabled = false;
      cancelGeneration = undefined;
    }
    function fail(message) {
      finish();
      if (token !== request) return;
      conformerStatus.textContent = message;
      setStatus(model ? '' : 'Choisis un exemple dans la bibliothèque.');
    }
    try {
      worker = new Worker('assets/conformer-worker.mjs', { type: 'module' });
    } catch {
      fail('Impossible de démarrer le calcul dans ce navigateur.');
      return;
    }
    submit.disabled = true;
    cancelGeneration = finish;
    timer = setTimeout(() => fail('Le calcul a pris trop de temps. Essaie une molécule plus simple.'), 25000);
    worker.addEventListener('error', () => fail('Le moteur de calcul n’a pas pu démarrer.'));
    worker.addEventListener('message', ({data}) => {
      if (token !== request) return finish();
      if (data.error) return fail(data.error);
      try {
        present({
          format: 'sdf', title: 'Conformère généré', type: 'Modèle calculé · OpenChemLib',
        }, data.sdf);
      } catch (error) {
        return fail(error.message);
      }
      finish();
      conformerStatus.textContent = 'Le conformère est prêt. Utilise Télécharger pour l’enregistrer en SDF.';
      stageToView();
    }, { once: true });
    worker.postMessage(smiles);
  }

  get('structure-file').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = '';
    if (!file || !viewer) return;
    const ext = file.name.toLowerCase().split('.').pop();
    const format = formatAliases[ext];
    if (!format || file.size > 5 * 1024 * 1024) {
      setStatus('Choisis un fichier SDF, MOL, PDB, CIF ou XYZ de 5 Mo maximum.');
      return;
    }
    const token = startRequest('Lecture du fichier…');
    try {
      const text = await file.text();
      if (token !== request) return;
      present({ title: file.name, type: 'Fichier local', format }, text);
      stageToView();
    } catch {
      if (token === request) setStatus('Ce fichier ne contient pas de coordonnées lisibles par la visionneuse.');
    }
  });

  get('compound-search').addEventListener('submit', searchCompound);
  get('conformer-form').addEventListener('submit', generate);
  get('search-kind').addEventListener('change', event => {
    get('compound-query').placeholder = event.target.value === 'smiles' ? 'Ex. CC(=O)OC1=CC=CC=C1C(=O)O' : 'Ex. caffeine ou 2519';
  });
  rotate.addEventListener('click', () => {
    spinning = !spinning;
    rotate.setAttribute('aria-pressed', String(spinning));
    viewer.spin(spinning ? 'y' : false);
  });
  reset.addEventListener('click', () => { stopSpin(); resetView(); });
  download.addEventListener('click', () => {
    if (!current || !modelText) return;
    const name = (current.id || current.title).replace(/[^\w-]+/g, '-').slice(0, 75);
    const url = URL.createObjectURL(new Blob([modelText], { type: 'chemical/x-' + current.format }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name + '.' + current.format;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  drawList(molecules, get('catalog-list'));
  drawList(crystals, get('crystal-list'));
  if (viewer) {
    const fromUrl = new URLSearchParams(location.search).get('structure')?.toUpperCase();
    void loadLocal(available.get(fromUrl) || molecules[0]);
  }
})();
