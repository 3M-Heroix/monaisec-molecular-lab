(() => {
  // Canvas fallback for browsers where a WebGL context cannot be created.
  class MolecularCanvas {
    constructor(container) {
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      this.context = this.canvas.getContext('2d');
      if (!this.context) throw new Error('Canvas indisponible');
      container.replaceChildren(this.canvas);
      this.container = container;
      this.models = [];
      this.shapes = [];
      this.labels = [];
      this.center = [0, 0, 0];
      this.radius = 1;
      this.magnification = 1;
      this.yaw = -.45;
      this.pitch = .34;
      this.resize();

      const pointers = new Map();
      const distance = ([a,b]) => Math.hypot(a.x - b.x, a.y - b.y);
      this.canvas.addEventListener('pointerdown', e => {
        this.canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
      });
      this.canvas.addEventListener('pointermove', e => {
        const old = pointers.get(e.pointerId);
        if (!old) return;
        const previous = pointers.size === 2 ? distance([...pointers.values()]) : null;
        pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
        if (previous) this.zoom(distance([...pointers.values()]) / previous);
        if (pointers.size === 1) {
          this.yaw += (e.clientX - old.x) * .012;
          this.pitch += (e.clientY - old.y) * .012;
        }
        this.render();
      });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.canvas.addEventListener(name, e => pointers.delete(e.pointerId));
      }
      this.canvas.addEventListener('wheel', e => {
        e.preventDefault();
        this.zoom(Math.exp(Math.max(-150, Math.min(150, -e.deltaY)) * .0026));
        this.render();
      }, { passive:false });
    }

    resize() {
      const { width, height } = this.container.getBoundingClientRect();
      this.size = { width, height };
      const density = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(width * density));
      this.canvas.height = Math.max(1, Math.round(height * density));
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.context.setTransform(density, 0, 0, density, 0, 0);
    }

    addModel(text, format, options) {
      const mol = new window.$3Dmol.GLModel(this.models.length);
      mol.addMolData(text, format, options);
      this.models.push(mol);
      return mol;
    }
    removeModel(mol) { this.models = this.models.filter(other => other !== mol); }
    removeAllShapes() { this.shapes = []; }
    removeAllLabels() { this.labels = []; }
    addLine(line) { this.shapes.push(line); }
    addLabel(text, options) { this.labels.push({ text, ...options }); }

    zoomTo(selection = {}) {
      const atoms = this.models.flatMap(mol => mol.selectedAtoms(selection));
      if (!atoms.length) return;
      this.center = ['x','y','z'].map(axis => {
        const values = atoms.map(atom => atom[axis]);
        return (Math.min(...values) + Math.max(...values)) / 2;
      });
      this.radius = Math.max(1.25, ...atoms.map(atom =>
        Math.hypot(atom.x - this.center[0], atom.y - this.center[1], atom.z - this.center[2])));
      this.magnification = 1;
    }

    zoom(factor) {
      this.magnification = Math.max(.35, Math.min(8, this.magnification * factor));
    }

    spin(axis) {
      cancelAnimationFrame(this.animation);
      if (!axis) return;
      let previous = 0;
      const step = time => {
        if (previous) this.yaw += .0007 * Math.min(time - previous, 32);
        previous = time;
        this.render();
        this.animation = requestAnimationFrame(step);
      };
      this.animation = requestAnimationFrame(step);
    }

    render() {
      const ctx = this.context;
      const { width, height } = this.size;
      const realScale = Math.min(width,height) * .41 * this.magnification / this.radius;
      const [cx,cy,cz] = this.center;
      const [ya,yb] = [Math.cos(this.yaw), Math.sin(this.yaw)];
      const [pa,pb] = [Math.cos(this.pitch), Math.sin(this.pitch)];
      const project = atom => {
        const x = atom.x - cx, y = atom.y - cy, z = atom.z - cz;
        const hx = ya * x + yb * z, hz = -yb * x + ya * z;
        return { x: width / 2 + hx * realScale, y: height / 2 - (y * pa - hz * pb) * realScale, z: y * pb + hz * pa };
      };
      ctx.clearRect(0,0,width,height);
      const atoms = this.models.flatMap(mol => mol.selectedAtoms({}));
      const primitives = [];
      const elements = { C:1.7, O:1.52, N:1.55, H:1.2, S:1.8, P:1.8 };
      const line = (a,b,w,color,z,dash=[],offset=0) => primitives.push({ z, paint() {
        const d = Math.hypot(b.x-a.x,b.y-a.y) || 1;
        const dx = (a.y-b.y) * offset / d, dy = (b.x-a.x) * offset / d;
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.moveTo(a.x+dx,a.y+dy);
        ctx.lineTo(b.x+dx,b.y+dy);
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.setLineDash([]);
      } });
      const points = new Map(atoms.map(atom => [atom.index, project(atom)]));
      const unique = new Map(atoms.map(atom => [atom.index, atom]));
      const atomColor = (style, atom) => style.color || style.colorscheme?.map?.[atom.elem] || '#9cc4cc';
      let lastCA;
      for (const atom of atoms) {
        const a = points.get(atom.index);
        const { stick, sphere, cartoon } = atom.style || {};
        if (cartoon && atom.atom === 'CA') {
          if (lastCA?.chain === atom.chain && atom.resi - lastCA.resi === 1) {
            const b = points.get(lastCA.index);
            line(a,b,Math.max(3,realScale*.21),cartoon.color || '#5ab6be',(a.z+b.z)/2);
          }
          lastCA = atom;
        }
        if (stick) {
          for (const [index, bonded] of (atom.bonds || []).entries()) {
            const neighbour = unique.get(bonded);
            if (!neighbour?.style?.stick || bonded <= atom.index) continue;
            const b = points.get(bonded);
            const shade = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
            shade.addColorStop(0,atomColor(stick,atom));
            shade.addColorStop(1,atomColor(neighbour.style.stick,neighbour));
            const diameter = Math.max(2,(stick.radius || .16)*realScale*1.45);
            const plane = (a.z+b.z)/2;
            if (atom.bondOrder?.[index] === 2) {
              line(a,b,diameter*.56,shade,plane,[],diameter*.43);
              line(a,b,diameter*.56,shade,plane,[],-diameter*.43);
            } else line(a,b,diameter,shade,plane);
          }
        }
        if (!sphere && !stick) continue;
        const color = atomColor(sphere || stick,atom);
        const radius = Math.max(1.7, realScale * (sphere?.radius ||
          (sphere ? (elements[atom.elem] || 1.6) * (sphere.scale ?? 1) : (stick.radius || .16) * .75)));
        primitives.push({ z:a.z, paint() {
          const gradient = ctx.createRadialGradient(a.x-radius*.33,a.y-radius*.42,0,a.x,a.y,radius);
          gradient.addColorStop(0,'#ffffff');
          gradient.addColorStop(.46,color);
          gradient.addColorStop(1, color + 'a9');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(a.x,a.y,radius,0,Math.PI*2);
          ctx.fill();
        } });
      }
      for (const shape of this.shapes) {
        const start = project(shape.start), end = project(shape.end);
        line(start,end,1.6,shape.color,Infinity,shape.dashed ? [4,4] : []);
      }
      primitives.sort((a,b) => a.z - b.z).forEach(item => item.paint());
      for (const [index,label] of this.labels.entries()) {
        const pos = project(label.position);
        const x = pos.x + (index % 2 ? 15 : -15);
        const y = pos.y + (index % 2 ? 22 : -12);
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        const measured = ctx.measureText(label.text).width;
        ctx.fillStyle = '#141f25';
        ctx.fillRect(x-measured/2-4,y-13,measured+8,18);
        ctx.fillStyle = label.fontColor;
        ctx.fillText(label.text,x,y);
      }
    }
  }
  window.MolecularCanvas = MolecularCanvas;
})();
