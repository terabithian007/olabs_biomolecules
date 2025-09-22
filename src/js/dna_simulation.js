import { renderWelcomeScreen } from './welcome.js';
import { renderNucliecAcidSelectionScreen } from './nucleic_acid_selection.js';
import { t, tFormat } from './translations.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';

import homeButtonImg from '../images/home_button.png';
import cursorHandImg from '../images/cursor_hand.png';
import starImg from '../images/star.png';

export function renderDNASimulation() { 
  let state = {
    step: 0,    
  };

  const app = document.getElementById('app');
  app.innerHTML = `
    <button id="home-btn" class="sim-btn" style="background: #000000; position: absolute; top: 18px; left: 0px; margin-top: 1rem; margin-left: 1.4rem; padding: 1.0rem 1.5rem; font-weight: bold; font-size: 1.1rem; box-shadow: 0 2px 4px #0002;"><img src="${homeButtonImg}" style="width: 1.1rem; height: 1.1rem; vertical-align: top; margin-right: 8px;">${t('mainMenuButton')}</button>
    <div class="sim-title">${t('title')}</div>
    <div style="display: flex; flex-direction: row; width: 100%;">
      <div class="sim-content-no-padding" id="ff-sim-card" style="flex: 4; position: relative; max-width: 1080px; width: 1080px; height: 675px; overflow: hidden; margin-left: 1.5rem;">
        <div class="sim-absolute-container" style="position: relative; width: 100%; height: 100%;">
          <div id="canvas-container" style="position: relative; width: 100%; height: 100%; background: #000;">
            <canvas id="renderCanvas"></canvas>
          </div>
          <div class="controls-help" id="controls-help-container">
            <p>${t('helpRotate')}</p>
            <p>${t('helpZoom')}</p>
          </div>
        </div>
      </div>
      <div class="sim-instructions-card" style="flex: 1; min-width: 200px; max-width: 320px; margin-left: 1rem; margin-right: 1.5rem;">
        <div class="sim-subtitle"><img src="${starImg}" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;">${t('instructions')}</div>
        <div class="sim-instructions" id="sim-instructions"></div>        
        <button id="next-btn" class="sim-btn" style="width: 100%; margin-top: 1.5rem;">${t('nextButton')}</button>
      </div>
    </div>
  `;

  // three.js scene globals for step 0
  let renderer; 
  let scene; 
  let camera; 
  let controls; 
  let animationFrameId; 
  let dnaGroup; 
  let sceneInitialized = false;
  // interaction state
  let raycaster; 
  let ndcPointer; 
  let isDraggingDNA = false; 
  let previousPointer = { x: 0, y: 0 }; 
  const orbitSpherical = new THREE.Spherical();
  let autoRotate = true;
  let numPairsGlobal = 0;
  const elements = {
    sugars1: [],
    sugars2: [],
    bases1: [],
    bases2: [],
    baseTypes1: [], // store base types for vertex calculations
    baseTypes2: [], // store base types for vertex calculations
    phosphates1: [],
    phosphates2: [],
    bondsSugarBase: [],
    bondsSugarPhosphate: [],
    bondsHydrogen: [],
    basePairKinds: [], // 'AT' or 'GC' for hydrogen bond count later
    dynamicBonds: [] // live-updating bonds used during/after unwind
  };
  
  const labels = {
    sugars1: [],
    sugars2: [],
    bases1: [],
    bases2: [],
    phosphates1: [],
    phosphates2: [],
    visible: false
  };
  const unwind = {
    started: false,
    finished: false,
    durationMs: 1600,
    startTime: 0,
    groupStartQuat: null,
    groupTargetQuat: new THREE.Quaternion(),
    starts: {
      sugars1: [],
      sugars2: [],
      bases1: [],
      bases2: [],
      phosphates1: [],
      phosphates2: []
    },
    targets: {
      sugars1: [],
      sugars2: [],
      bases1: [],
      bases2: [],
      phosphates1: [],
      phosphates2: []
    },
    live: {
      bondsSugarBase: [], // { mesh }
      bondsPhospho1: [],  // { mesh } strand 1: sugar i → phosphate i
      bondsPhospho1_3: [],// { mesh } strand 1: phosphate i → sugar i+1
      bondsPhospho2: [],  // { mesh } strand 2: sugar i → phosphate i (between i-1 and i)
      bondsPhospho2_3: [],// { mesh } strand 2: phosphate i → sugar i-1
      bondsHydrogen: []   // { mesh, i, offset }
    }
  };

  function initThree() {
    const canvas = document.getElementById('renderCanvas');
    const container = document.getElementById('canvas-container');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 35, 100);

    scene = new THREE.Scene();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.6);
    scene.add(hemi);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(10, 20, 10);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir2.position.set(-15, -10, -10);
    scene.add(dir2);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.6;
    controls.enablePan = true;
    controls.enableRotate = false;     

    controls.target.set(0.0, 0.0, 100.0);
    controls.update()

    window.addEventListener('resize', onResize);
    // set up interaction helpers
    raycaster = new THREE.Raycaster();
    ndcPointer = new THREE.Vector2();
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUpOrLeave);
    el.addEventListener('pointerleave', onPointerUpOrLeave);
  }

  function onResize() {
    const container = document.getElementById('canvas-container');
    if (!renderer || !camera || !container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  function createBondCylinder(start, end, radius, color) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    
    // Use much thinner radius for line-like appearance, consistent with curved bonds
    const thinRadius = radius;
    const geometry = new THREE.CylinderGeometry(thinRadius, thinRadius, length, 12); // More segments for smoother appearance
    
    // Create shiny material for better visibility, consistent with curved bonds
    const material = new THREE.MeshStandardMaterial({ 
      color, 
      metalness: 0.8,        // Much more metallic
      roughness: 0.1,        // Very smooth/shiny
      emissive: color,       // Emissive glow
      emissiveIntensity: 0.15 // Stronger glow for visibility
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return mesh;
  }


  function createPentagonPrism(radius, thickness, color) {
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 5);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
    return new THREE.Mesh(geometry, material);
  }

  function createHexagonPrism(radius, thickness, color) {
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 6);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
    return new THREE.Mesh(geometry, material);
  }

  function createRegularPrismWithTopEdge(n, side, thickness, color, putCenterAboveEdge=false) {
    const R = side / (2 * Math.sin(Math.PI / n));       // circumradius
    const a = R * Math.cos(Math.PI / n);                // apothem
  
    // Center location relative to the shared edge y=0
    const cy = putCenterAboveEdge ? +a : -a;
  
    // Angle from center to the RIGHT endpoint of the shared edge.
    // If the edge is above the center (center below), aim at +Y (π/2), else at -Y (-π/2),
    // then rotate by ±π/n to hit the vertex.
    const theta0 = putCenterAboveEdge
      ? (-Math.PI / 2 + Math.PI / n)   // edge is below center
      : ( Math.PI / 2 - Math.PI / n);  // edge is above center
  
    // Build the 2D polygon with that edge as the closing edge (last→first)
    const verts = [];
    const step = 2 * Math.PI / n;
    for (let k = 0; k < n; k++) {
      const t = theta0 + k * step;
      const x = R * Math.cos(t);
      const y = cy + R * Math.sin(t);
      verts.push(new THREE.Vector2(x, y));
    }
  
    const shape = new THREE.Shape(verts);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  
    // Put thickness along Y (so the polygon lies in XZ like your cylinders)
    geo.rotateX(Math.PI / 2);    
    geo.translate(0, thickness / 2, 0);
  
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.8 });
    return new THREE.Mesh(geo, mat);
  }  

  function createPhosphateSphere(radius, color) {
    const geometry = new THREE.SphereGeometry(radius, 24, 16);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    return new THREE.Mesh(geometry, material);
  }

  function createTextLabel(text, position, size = 2.0) {
    // Create a canvas element to draw text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // Set canvas size
    const canvasSize = 128;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    
    // Set font and measure text
    const fontSize = canvasSize * 0.6;
    context.font = `bold ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Clear canvas with transparent background
    context.clearRect(0, 0, canvasSize, canvasSize);
    
    // Draw white text with black outline for better visibility
    context.strokeStyle = 'black';
    context.lineWidth = fontSize * 0.1;
    context.fillStyle = 'white';
    
    // Draw outline
    context.strokeText(text, canvasSize/2, canvasSize/2);
    // Draw fill
    context.fillText(text, canvasSize/2, canvasSize/2);
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // Create material
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true
    });
    
    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geometry, material);
    
    // Position the label
    mesh.position.copy(position);
    
    // All labels face the same direction (towards positive Z axis) for consistent orientation
    mesh.lookAt(position.clone().add(new THREE.Vector3(0, 50, 0)));
    
    return mesh;
  }

  function createLabelsForElements() {
    if (!dnaGroup || !unwind.finished) return;
    
    // Clear existing labels
    clearLabels();
    
    // Create labels for sugars (D for Deoxyribose) - slightly forward from the pentagon face
    elements.sugars1.forEach((sugar, i) => {
      const sugarPos = sugar.mesh.position.clone();
      // Position label slightly forward from the sugar face to avoid z-fighting
      const labelPos = sugarPos.clone().add(new THREE.Vector3(0, 0.8, 0.0));
      const label = createTextLabel('D', labelPos, 1.5);
      dnaGroup.add(label);
      labels.sugars1.push(label);
    });
    
    elements.sugars2.forEach((sugar, i) => {
      const sugarPos = sugar.mesh.position.clone();
      // Position label slightly forward from the sugar face to avoid z-fighting
      const labelPos = sugarPos.clone().add(new THREE.Vector3(0, 0.8, 0.0));
      const label = createTextLabel('D', labelPos, 1.5);
      dnaGroup.add(label);
      labels.sugars2.push(label);
    });
    
    // Create labels for bases (A, G, T, C) - slightly forward from the base face
    elements.bases1.forEach((base, i) => {
      const basePos = base.mesh.position.clone();
      const baseType = elements.baseTypes1[i];
      // Position label slightly forward from the base face to avoid z-fighting
      const labelPos = basePos.clone().add(new THREE.Vector3(0, 0.8, 0.0));
      const label = createTextLabel(baseType, labelPos, 1.5);
      dnaGroup.add(label);
      labels.bases1.push(label);
    });
    
    elements.bases2.forEach((base, i) => {
      const basePos = base.mesh.position.clone();
      const baseType = elements.baseTypes2[i];
      // Position label slightly forward from the base face to avoid z-fighting
      const labelPos = basePos.clone().add(new THREE.Vector3(0, 0.8, 0.0));
      const label = createTextLabel(baseType, labelPos, 1.5);
      dnaGroup.add(label);
      labels.bases2.push(label);
    });
    
    // Create labels for phosphates (P) - on the side opposite to center
    elements.phosphates1.forEach((phosphate, i) => {
      const phosphatePos = phosphate.mesh.position.clone();
      // Phosphate1 is on the left side (negative X), so place label further left
      const labelPos = phosphatePos.clone().add(new THREE.Vector3(-1.5, 0, 0));
      const label = createTextLabel('P', labelPos, 1.5);
      dnaGroup.add(label);
      labels.phosphates1.push(label);
    });
    
    elements.phosphates2.forEach((phosphate, i) => {
      const phosphatePos = phosphate.mesh.position.clone();
      // Phosphate2 is on the right side (positive X), so place label further right
      const labelPos = phosphatePos.clone().add(new THREE.Vector3(1.5, 0, 0));
      const label = createTextLabel('P', labelPos, 1.5);
      dnaGroup.add(label);
      labels.phosphates2.push(label);
    });
    
    labels.visible = true;
  }

  function clearLabels() {
    // Remove all existing labels from the scene
    const allLabels = [
      ...labels.sugars1,
      ...labels.sugars2,
      ...labels.bases1,
      ...labels.bases2,
      ...labels.phosphates1,
      ...labels.phosphates2
    ];
    
    allLabels.forEach(label => {
      if (label && label.parent) {
        label.parent.remove(label);
        // Dispose of geometry and material to free memory
        if (label.geometry) label.geometry.dispose();
        if (label.material) {
          if (label.material.map) label.material.map.dispose();
          label.material.dispose();
        }
      }
    });
    
    // Clear the arrays
    labels.sugars1 = [];
    labels.sugars2 = [];
    labels.bases1 = [];
    labels.bases2 = [];
    labels.phosphates1 = [];
    labels.phosphates2 = [];
    labels.visible = false;
  }

  function updateLabelPositions() {
    if (!labels.visible || !dnaGroup) return;
    
    // Update sugar labels - slightly forward from the pentagon face
    elements.sugars1.forEach((sugar, i) => {
      if (labels.sugars1[i]) {
        const labelPos = sugar.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0.0));
        labels.sugars1[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.sugars1[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
    
    elements.sugars2.forEach((sugar, i) => {
      if (labels.sugars2[i]) {
        const labelPos = sugar.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0.0));
        labels.sugars2[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.sugars2[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
    
    // Update base labels - slightly forward from the base face
    elements.bases1.forEach((base, i) => {
      if (labels.bases1[i]) {
        const labelPos = base.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0.0));
        labels.bases1[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.bases1[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
    
    elements.bases2.forEach((base, i) => {
      if (labels.bases2[i]) {
        const labelPos = base.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0.0));
        labels.bases2[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.bases2[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
    
    // Update phosphate labels - on the side opposite to center
    elements.phosphates1.forEach((phosphate, i) => {
      if (labels.phosphates1[i]) {
        // Phosphate1 is on the left side (negative X), so place label further left
        const labelPos = phosphate.mesh.position.clone().add(new THREE.Vector3(-1.5, 0, 0));
        labels.phosphates1[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.phosphates1[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
    
    elements.phosphates2.forEach((phosphate, i) => {
      if (labels.phosphates2[i]) {
        // Phosphate2 is on the right side (positive X), so place label further right
        const labelPos = phosphate.mesh.position.clone().add(new THREE.Vector3(1.5, 0, 0));
        labels.phosphates2[i].position.copy(labelPos);
        // All labels face the same direction (towards positive Z axis) for consistent orientation
        labels.phosphates2[i].lookAt(labelPos.clone().add(new THREE.Vector3(0, 50, 0)));
      }
    });
  }

  // ---------- Unwind (flatten to plane) helpers ----------
  function computePlanarTargets() {
    const railHalfSeparation = 6.0; // rail separation along X in the viewed plane
    const stepX = 5.0;
    const centerZ = controls && controls.target ? controls.target.z : 0;
    const centerShiftZ = centerZ - ((numPairsGlobal - 1) * stepX) / 2;
    const basesShiftZ_AG = 3.0;
    let basesShiftZ_TC = 3.0;

    function lookAtQuaternion(from, to) {
      const m = new THREE.Matrix4();
      // Keep Y as up so polygons lie in the XZ plane (y=0)
      m.lookAt(from, to, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion();
      q.setFromRotationMatrix(m);
      return q;
    }

    // Place sugars along rails at x=±railHalfSeparation, y=0, z increasing with i
    unwind.targets.sugars1 = elements.sugars1.map((_, i) => {
      const pos = new THREE.Vector3(-railHalfSeparation, 0, centerShiftZ + i * stepX);
      // Create flipped orientation: horizontal flip (rotate 180° around Y) + vertical flip (rotate 180° around X)
      const quat = new THREE.Quaternion();
      quat.setFromEuler(new THREE.Euler(Math.PI, Math.PI - Math.PI/5, 0, 'XYZ')); // 180° around X and Y axes
      return { pos, quat };
    });
    unwind.targets.sugars2 = elements.sugars2.map((_, i) => {
      const pos = new THREE.Vector3(railHalfSeparation, 0, centerShiftZ + i * stepX);      
      const quat = new THREE.Quaternion();
      quat.setFromEuler(new THREE.Euler(Math.PI, Math.PI, 0, 'XYZ')); // 180° around X and Y axes
      return { pos, quat };
    });

    // Bases positioned based on type - different arrangements for purines (A,G) vs pyrimidines (T,C)
    unwind.targets.bases1 = elements.bases1.map((_, i) => {
      const baseType = elements.baseTypes1[i];
      let pos;
      let quat;
      
      if (baseType === 'A' || baseType === 'G') {
        // Purines (A,G): pentagon above hexagon, positioned closer to sugar
        pos = new THREE.Vector3(-2.5, 0, centerShiftZ + i * stepX - basesShiftZ_AG);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, -3*Math.PI/4 + Math.PI/12, 0, 'XYZ')); // Clockwise rotation around Z-axis
      } else {
        // Pyrimidines (T,C): single hexagon        
        pos = new THREE.Vector3(-2.5, 0, centerShiftZ + i * stepX - basesShiftZ_TC);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, -3*Math.PI/4 + 3*Math.PI/12, 0, 'XYZ')); // Clockwise rotation around Z-axis
      }
      
      return { pos, quat };
    });
    
    unwind.targets.bases2 = elements.bases2.map((_, i) => {
      const baseType = elements.baseTypes2[i];
      let pos;
      let quat;
      
      if (baseType === 'A' || baseType === 'G') {
        // Purines (A,G): pentagon above hexagon, positioned closer to sugar
        pos = new THREE.Vector3(2.5, 0, centerShiftZ + i * stepX - basesShiftZ_AG);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, 3*Math.PI/4 - Math.PI/12, 0, 'XYZ')); // 180° around Y + PI/4 anticlockwise around Z
      } else {
        // Pyrimidines (T,C): single hexagon
        pos = new THREE.Vector3(2.5, 0, centerShiftZ + i * stepX - basesShiftZ_TC);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, 3*Math.PI/4 - 3*Math.PI/12, 0, 'XYZ')); // 180° around Y + PI/4 anticlockwise around Z
      }
      
      return { pos, quat };
    });

    // Phosphates placed slightly outside rails along X, y=0, z midway between sugars
    unwind.targets.phosphates1 = elements.phosphates1.map(({ i }) => {
      const z = centerShiftZ + (i + 0.5) * stepX;
      const pos = new THREE.Vector3(-railHalfSeparation - 1.2, 0, z);
      return { pos, quat: new THREE.Quaternion() };
    });
    unwind.targets.phosphates2 = elements.phosphates2.map(({ i }) => {
      const z = centerShiftZ + (i - 0.5) * stepX;
      const pos = new THREE.Vector3(railHalfSeparation + 1.2, 0, z);
      return { pos, quat: new THREE.Quaternion() };
    });
  }

  // New function for expanded planar targets used in step 4
  function computePlanarTargetsExpanded() {
    const railHalfSeparation = 6.0; // rail separation along X in the viewed plane
    const stepX = 7.0; // Increased spacing for expansion
    const centerZ = controls && controls.target ? controls.target.z : 0;
    const centerShiftZ = centerZ - ((numPairsGlobal - 1) * stepX) / 2;
    const basesShiftZ_AG = 3.0;
    let basesShiftZ_TC = 2.5; // New value for expansion

    function lookAtQuaternion(from, to) {
      const m = new THREE.Matrix4();
      // Keep Y as up so polygons lie in the XZ plane (y=0)
      m.lookAt(from, to, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion();
      q.setFromRotationMatrix(m);
      return q;
    }

    // Place sugars along rails at x=±railHalfSeparation, y=0, z increasing with i
    unwind.targets.sugars1 = elements.sugars1.map((_, i) => {
      const pos = new THREE.Vector3(-railHalfSeparation, 0, centerShiftZ + i * stepX);
      // Create flipped orientation: horizontal flip (rotate 180° around Y) + vertical flip (rotate 180° around X)
      const quat = new THREE.Quaternion();
      quat.setFromEuler(new THREE.Euler(Math.PI, Math.PI - Math.PI/5, 0, 'XYZ')); // 180° around X and Y axes
      return { pos, quat };
    });
    unwind.targets.sugars2 = elements.sugars2.map((_, i) => {
      const pos = new THREE.Vector3(railHalfSeparation, 0, centerShiftZ + i * stepX);
      // Create flipped orientation: horizontal flip (rotate 180° around Y) + vertical flip (rotate 180° around X)
      const quat = new THREE.Quaternion();
      quat.setFromEuler(new THREE.Euler(Math.PI, Math.PI, 0, 'XYZ')); // 180° around X and Y axes
      return { pos, quat };
    });

    // Bases positioned based on type - different arrangements for purines (A,G) vs pyrimidines (T,C)
    unwind.targets.bases1 = elements.bases1.map((_, i) => {
      const baseType = elements.baseTypes1[i];
      let pos;
      let quat;
      
      if (baseType === 'A' || baseType === 'G') {
        // Purines (A,G): pentagon above hexagon, positioned closer to sugar
        pos = new THREE.Vector3(-2.5, 0, centerShiftZ + i * stepX - basesShiftZ_AG);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, -3*Math.PI/4 + Math.PI/12, 0, 'XYZ')); // Clockwise rotation around Z-axis
      } else {
        // Pyrimidines (T,C): single hexagon        
        pos = new THREE.Vector3(-2.5, 0, centerShiftZ + i * stepX - basesShiftZ_TC);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, -3*Math.PI/4 + 3*Math.PI/12, 0, 'XYZ')); // Clockwise rotation around Z-axis
      }
      
      return { pos, quat };
    });
    
    unwind.targets.bases2 = elements.bases2.map((_, i) => {
      const baseType = elements.baseTypes2[i];
      let pos;
      let quat;
      
      if (baseType === 'A' || baseType === 'G') {
        // Purines (A,G): pentagon above hexagon, positioned closer to sugar
        pos = new THREE.Vector3(2.5, 0, centerShiftZ + i * stepX - basesShiftZ_AG);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, 3*Math.PI/4 - Math.PI/12, Math.PI, 'XYZ')); // 180° around Y + PI/4 anticlockwise around Z
      } else {
        // Pyrimidines (T,C): single hexagon
        pos = new THREE.Vector3(2.5, 0, centerShiftZ + i * stepX - basesShiftZ_TC);
        quat = new THREE.Quaternion();
        quat.setFromEuler(new THREE.Euler(0, 3*Math.PI/4 - 3*Math.PI/12, Math.PI, 'XYZ')); // 180° around Y + PI/4 anticlockwise around Z
      }
      
      return { pos, quat };
    });

    // Phosphates placed slightly outside rails along X, y=0, z midway between sugars
    unwind.targets.phosphates1 = elements.phosphates1.map(({ i }) => {
      const z = centerShiftZ + (i + 0.5) * stepX;
      const pos = new THREE.Vector3(-railHalfSeparation - 1.2, 0, z);
      return { pos, quat: new THREE.Quaternion() };
    });
    unwind.targets.phosphates2 = elements.phosphates2.map(({ i }) => {
      const z = centerShiftZ + (i - 0.5) * stepX;
      const pos = new THREE.Vector3(railHalfSeparation + 1.2, 0, z);
      return { pos, quat: new THREE.Quaternion() };
    });
  }

  // New bond rendering function for the expanded structure in step 4
  function renderExpandedBonds() {
    if (!dnaGroup) return;
    
    // Clear existing dynamic bonds
    const bondsToRemove = [
      ...unwind.live.bondsSugarBase,
      ...unwind.live.bondsPhospho1,
      ...unwind.live.bondsPhospho1_3,
      ...unwind.live.bondsPhospho2,
      ...unwind.live.bondsPhospho2_3,
      ...unwind.live.bondsHydrogen
    ];
    
    bondsToRemove.forEach(({ mesh }) => {
      if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    });
    
    // Clear the arrays
    unwind.live.bondsSugarBase = [];
    unwind.live.bondsPhospho1 = [];
    unwind.live.bondsPhospho1_3 = [];
    unwind.live.bondsPhospho2 = [];
    unwind.live.bondsPhospho2_3 = [];
    unwind.live.bondsHydrogen = [];

    const addExpandedBond = (mesh) => {
      mesh.material.transparent = false;
      mesh.material.opacity = 1.0;      
      mesh.material.metalness = 0.9;
      mesh.material.roughness = 0.1;
      mesh.material.emissiveIntensity = 0.2;
      return mesh;
    };

    // Sugar→Base bonds with enhanced visibility
    const sugarSize = 1.2;
    const baseSize = 1.2;
    for (let i = 0; i < elements.bases1.length; i++) {
      const s1 = elements.sugars1[i].mesh.position.clone();
      let sVertex = s1.clone().add(
        new THREE.Vector3(
          sugarSize * Math.cos(Math.PI/10), 
          0, 
          -sugarSize * Math.sin(Math.PI/10)
        )
      );
      const b1 = elements.bases1[i].mesh.position.clone();
      let bVertex = b1.clone();
      const baseType1 = elements.baseTypes1[i];
      if(baseType1 === 'A' || baseType1 === 'G') {
        bVertex = b1.clone().add(
          new THREE.Vector3(
            -1.4, 
            0, 
            0
          )
        );        
      } else {
        bVertex = b1.clone().add(
          new THREE.Vector3(
            -baseSize*0.5, 
            0, 
            baseSize*0.87
          )
        );           
      }        
      const m1 = addExpandedBond(createBondCylinder(sVertex, bVertex, 0.08, 0xa8a8a8)); // Thicker and brighter
      dnaGroup.add(m1);
      unwind.live.bondsSugarBase.push({ mesh: m1 });
    }    
    for (let i = 0; i < elements.bases2.length; i++) {
      const s2 = elements.sugars2[i].mesh.position.clone();
      const b2 = elements.bases2[i].mesh.position.clone();
      let sVertex = s2.clone().add(
        new THREE.Vector3(
          -sugarSize * Math.cos(Math.PI/10), 
          0, 
          sugarSize * Math.sin(Math.PI/10)
        )
      );
      let bVertex = b2.clone();
      const baseType2 = elements.baseTypes2[i];
      if(baseType2 === 'A' || baseType2 === 'G') {
        bVertex = b2.clone().add(
          new THREE.Vector3(
            1.4, 
            0, 
            0
          )
        );        
      } else {
        bVertex = b2.clone().add(
          new THREE.Vector3(
            baseSize*0.5, 
            0, 
            baseSize*0.87
          )
        );
      }
      const m2 = addExpandedBond(createBondCylinder(sVertex, bVertex, 0.08, 0xa8a8a8)); // Thicker and brighter
      dnaGroup.add(m2);
      unwind.live.bondsSugarBase.push({ mesh: m2 });
    }

    // Enhanced phosphodiester bonds - Strand 1
    for (let k = 0; k < elements.phosphates1.length; k++) {
      const i = k;
      const s5 = elements.sugars1[i].mesh.position.clone();
      let s5Vertex = s5.clone().add(
        new THREE.Vector3(
          -sugarSize * Math.sin(Math.PI/5) + 0.1, 
          0, 
          sugarSize * Math.cos(Math.PI/5)
        )
      );
      const ph = elements.phosphates1[k].mesh.position.clone();
      const s3 = elements.sugars1[i + 1].mesh.position.clone();
      let s3Vertex = s3.clone().add(
        new THREE.Vector3(
          -sugarSize * Math.cos(Math.PI/10), 
          0, 
          -sugarSize * Math.sin(Math.PI/10)
        )
      );
      let midPoint = new THREE.Vector3().addVectors(s3Vertex, ph).multiplyScalar(0.5);
      let midPointShifted = midPoint.clone().add(
        new THREE.Vector3(
          -1.0, 
          0, 
          0.0
        )
      );
      const b1 = addExpandedBond(createBondCylinder(s5Vertex, ph, 0.12, 0xb3e5fc)); // Enhanced cyan
      const b2 = addExpandedBond(createBondCylinder(ph, midPointShifted, 0.08, 0xffcc80)); // Enhanced orange
      const b3 = addExpandedBond(createBondCylinder(midPointShifted, s3Vertex, 0.08, 0xffcc80)); // Enhanced orange
      dnaGroup.add(b1); dnaGroup.add(b2); dnaGroup.add(b3);
      unwind.live.bondsPhospho1.push({ mesh: b1 });
      unwind.live.bondsPhospho1_3.push({ mesh: b2 });
      unwind.live.bondsPhospho1_3.push({ mesh: b3 });
    }

    // Enhanced phosphodiester bonds - Strand 2
    for (let k = 0; k < elements.phosphates2.length; k++) {
      const i = elements.phosphates2[k].i;
      const s5 = elements.sugars2[i].mesh.position.clone();
      let s5Vertex = s5.clone().add(
        new THREE.Vector3(
          sugarSize * Math.sin(Math.PI/5) - 0.1, 
          0, 
          -sugarSize * Math.cos(Math.PI/5)
        )
      );
      const ph = elements.phosphates2[k].mesh.position.clone();
      const s3 = elements.sugars2[i - 1].mesh.position.clone();
      let s3Vertex = s3.clone().add(
        new THREE.Vector3(
          sugarSize * Math.cos(Math.PI/10), 
          0, 
          sugarSize * Math.sin(Math.PI/10)
        )
      );
      let midPoint = new THREE.Vector3().addVectors(s3Vertex, ph).multiplyScalar(0.5);
      let midPointShifted = midPoint.clone().add(
        new THREE.Vector3(
          1.0, 
          0, 
          0.0
        )
      );
      const b1 = addExpandedBond(createBondCylinder(s5Vertex, ph, 0.12, 0xb3e5fc)); // Enhanced cyan
      const b2 = addExpandedBond(createBondCylinder(ph, midPointShifted, 0.08, 0xffcc80)); // Enhanced orange
      const b3 = addExpandedBond(createBondCylinder(midPointShifted, s3Vertex, 0.08, 0xffcc80)); // Enhanced orange
      dnaGroup.add(b1); dnaGroup.add(b2); dnaGroup.add(b3);
      unwind.live.bondsPhospho2.push({ mesh: b1 });
      unwind.live.bondsPhospho2_3.push({ mesh: b2 });
      unwind.live.bondsPhospho2_3.push({ mesh: b3 });
    }

    // Enhanced hydrogen bonds with vertex-based connections
    for (let i = 0; i < elements.bases1.length; i++) {
      const kind = elements.basePairKinds[i] || 'AT';
      const baseType1 = elements.baseTypes1[i];
      const baseType2 = elements.baseTypes2[i];
      const baseMesh1 = elements.bases1[i].mesh;
      const baseMesh2 = elements.bases2[i].mesh;
      
      let bonds = [];
      
      // Create bonds based on base pair type
      if (kind === 'AT') {
        bonds = createATHydrogenBonds(baseMesh1, baseMesh2, baseType1, baseType2);
      } else if (kind === 'GC') {
        bonds = createGCHydrogenBonds(baseMesh1, baseMesh2, baseType1, baseType2);
      }
      
      // Render each bond
      bonds.forEach((bond, bondIndex) => {
        const m = addExpandedBond(createBondCylinder(bond.start, bond.end, 0.08, 0xffffff));        
        dnaGroup.add(m);
        unwind.live.bondsHydrogen.push({ mesh: m });
      });
    }
  }

  // Animation state for structure expansion
  const expansion = {
    started: false,
    finished: false,
    durationMs: 2000, // Longer duration for smoother expansion
    startTime: 0,
    starts: {
      sugars1: [],
      sugars2: [],
      bases1: [],
      bases2: [],
      phosphates1: [],
      phosphates2: []
    },
    targets: {
      sugars1: [],
      sugars2: [],
      bases1: [],
      bases2: [],
      phosphates1: [],
      phosphates2: []
    }
  };

  // Function to remove all bonds during expansion
  function removeBondsDuringExpansion() {
    if (!dnaGroup) return;
    
    console.log('Removing all bonds during expansion');
    
    // Remove all dynamic bonds from unwind.live arrays
    const bondsToRemove = [
      ...unwind.live.bondsSugarBase,
      ...unwind.live.bondsPhospho1,
      ...unwind.live.bondsPhospho1_3,
      ...unwind.live.bondsPhospho2,
      ...unwind.live.bondsPhospho2_3,
      ...unwind.live.bondsHydrogen
    ];
    
    bondsToRemove.forEach(({ mesh }) => {
      if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    });
    
    // Clear the arrays
    unwind.live.bondsSugarBase = [];
    unwind.live.bondsPhospho1 = [];
    unwind.live.bondsPhospho1_3 = [];
    unwind.live.bondsPhospho2 = [];
    unwind.live.bondsPhospho2_3 = [];
    unwind.live.bondsHydrogen = [];
    
    // Also remove any remaining static bonds if they exist
    const staticBondsToRemove = [
      ...elements.bondsSugarBase,
      ...elements.bondsSugarPhosphate,
      ...elements.bondsHydrogen
    ];
    
    staticBondsToRemove.forEach(mesh => {
      if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    });
    
    // Clear the static bond arrays
    elements.bondsSugarBase = [];
    elements.bondsSugarPhosphate = [];
    elements.bondsHydrogen = [];
    
    console.log('All bonds removed during expansion');
  }

  // Function to start the structure expansion sequence
  function startStructureExpansion() {
    if (!dnaGroup || expansion.started || expansion.finished || !unwind.finished) return;
    
    console.log('Starting structure expansion sequence');
    
    // Remove all bonds before starting expansion
    removeBondsDuringExpansion();
    
    // Capture current positions as starting points
    expansion.starts.sugars1 = elements.sugars1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    expansion.starts.sugars2 = elements.sugars2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    expansion.starts.bases1 = elements.bases1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    expansion.starts.bases2 = elements.bases2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    expansion.starts.phosphates1 = elements.phosphates1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    expansion.starts.phosphates2 = elements.phosphates2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    
    // Compute expanded targets
    computePlanarTargetsExpanded();
    expansion.targets.sugars1 = [...unwind.targets.sugars1];
    expansion.targets.sugars2 = [...unwind.targets.sugars2];
    expansion.targets.bases1 = [...unwind.targets.bases1];
    expansion.targets.bases2 = [...unwind.targets.bases2];
    expansion.targets.phosphates1 = [...unwind.targets.phosphates1];
    expansion.targets.phosphates2 = [...unwind.targets.phosphates2];
    
    expansion.started = true;
    expansion.startTime = performance.now();
  }

  // Function to revert DNA back to original 3D helical form
  function revertToOriginalHelix() {
    if (!dnaGroup) return;
    
    console.log('Reverting DNA back to original 3D helical form');
    
    // Clear labels and prongs that were added during expansion
    clearLabels();
    clearProngsFromAllBases();
    
    // Remove all dynamic bonds
    const bondsToRemove = [
      ...unwind.live.bondsSugarBase,
      ...unwind.live.bondsPhospho1,
      ...unwind.live.bondsPhospho1_3,
      ...unwind.live.bondsPhospho2,
      ...unwind.live.bondsPhospho2_3,
      ...unwind.live.bondsHydrogen
    ];
    
    bondsToRemove.forEach(({ mesh }) => {
      if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    });
    
    // Clear the dynamic bond arrays
    unwind.live.bondsSugarBase = [];
    unwind.live.bondsPhospho1 = [];
    unwind.live.bondsPhospho1_3 = [];
    unwind.live.bondsPhospho2 = [];
    unwind.live.bondsPhospho2_3 = [];
    unwind.live.bondsHydrogen = [];
    
    // Reset animation states
    unwind.started = false;
    unwind.finished = false;
    expansion.started = false;
    expansion.finished = false;
    
    // Restore original positions and rotations from unwind.starts (which were captured from buildDNAHelix)
    if (unwind.starts.sugars1.length > 0) {
      elements.sugars1.forEach(({ mesh }, i) => {
        if (unwind.starts.sugars1[i]) {
          mesh.position.copy(unwind.starts.sugars1[i].pos);
          mesh.quaternion.copy(unwind.starts.sugars1[i].quat);
        }
      });
    }
    
    if (unwind.starts.sugars2.length > 0) {
      elements.sugars2.forEach(({ mesh }, i) => {
        if (unwind.starts.sugars2[i]) {
          mesh.position.copy(unwind.starts.sugars2[i].pos);
          mesh.quaternion.copy(unwind.starts.sugars2[i].quat);
        }
      });
    }
    
    if (unwind.starts.bases1.length > 0) {
      elements.bases1.forEach(({ mesh }, i) => {
        if (unwind.starts.bases1[i]) {
          mesh.position.copy(unwind.starts.bases1[i].pos);
          mesh.quaternion.copy(unwind.starts.bases1[i].quat);
        }
      });
    }
    
    if (unwind.starts.bases2.length > 0) {
      elements.bases2.forEach(({ mesh }, i) => {
        if (unwind.starts.bases2[i]) {
          mesh.position.copy(unwind.starts.bases2[i].pos);
          mesh.quaternion.copy(unwind.starts.bases2[i].quat);
        }
      });
    }
    
    if (unwind.starts.phosphates1.length > 0) {
      elements.phosphates1.forEach(({ mesh }, i) => {
        if (unwind.starts.phosphates1[i]) {
          mesh.position.copy(unwind.starts.phosphates1[i].pos);
          mesh.quaternion.copy(unwind.starts.phosphates1[i].quat);
        }
      });
    }
    
    if (unwind.starts.phosphates2.length > 0) {
      elements.phosphates2.forEach(({ mesh }, i) => {
        if (unwind.starts.phosphates2[i]) {
          mesh.position.copy(unwind.starts.phosphates2[i].pos);
          mesh.quaternion.copy(unwind.starts.phosphates2[i].quat);
        }
      });
    }
    
    // Restore original group rotation
    if (unwind.groupStartQuat) {
      dnaGroup.setRotationFromQuaternion(unwind.groupStartQuat);
    }
    
    // Rebuild original static bonds from buildDNAHelix
    rebuildOriginalBonds();
    
    // Re-enable auto-rotation for the original helix
    autoRotate = true;
    
    console.log('DNA reverted to original 3D helical form');
  }

  // Function to clear prongs from all bases
  function clearProngsFromAllBases() {
    if (!elements.bases1 || !elements.bases2) return;
    
    // Remove prongs from strand 1 bases
    elements.bases1.forEach((baseObj) => {
      if (baseObj.mesh && baseObj.mesh.children) {
        // Remove any prong children (they are groups with prong geometry)
        const childrenToRemove = baseObj.mesh.children.filter(child => 
          child.type === 'Group' && child.children.some(grandchild => 
            grandchild.geometry && grandchild.geometry.type === 'CylinderGeometry'
          )
        );
        
        childrenToRemove.forEach(child => {
          baseObj.mesh.remove(child);
          // Dispose of geometries and materials
          child.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        });
      }
    });
    
    // Remove prongs from strand 2 bases
    elements.bases2.forEach((baseObj) => {
      if (baseObj.mesh && baseObj.mesh.children) {
        // Remove any prong children (they are groups with prong geometry)
        const childrenToRemove = baseObj.mesh.children.filter(child => 
          child.type === 'Group' && child.children.some(grandchild => 
            grandchild.geometry && grandchild.geometry.type === 'CylinderGeometry'
          )
        );
        
        childrenToRemove.forEach(child => {
          baseObj.mesh.remove(child);
          // Dispose of geometries and materials
          child.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        });
      }
    });
  }

  // Function to rebuild original static bonds from buildDNAHelix
  function rebuildOriginalBonds() {
    if (!dnaGroup) return;
    
    // Clear any existing static bonds
    const staticBondsToRemove = [
      ...elements.bondsSugarBase,
      ...elements.bondsSugarPhosphate,
      ...elements.bondsHydrogen
    ];
    
    staticBondsToRemove.forEach(mesh => {
      if (mesh && mesh.parent) {
        mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
    });
    
    // Clear the static bond arrays
    elements.bondsSugarBase = [];
    elements.bondsSugarPhosphate = [];
    elements.bondsHydrogen = [];
    
    // Rebuild sugar-base bonds
    const bondColor = 0x888888;
    for (let i = 0; i < elements.bases1.length; i++) {
      const s1Pos = elements.sugars1[i].mesh.position;
      const s2Pos = elements.sugars2[i].mesh.position;
      const b1Pos = elements.bases1[i].mesh.position;
      const b2Pos = elements.bases2[i].mesh.position;
      
      const baseAttach1 = getBaseSugarAttachmentPoint(elements.bases1[i].mesh, s1Pos, elements.baseTypes1[i]);
      const baseAttach2 = getBaseSugarAttachmentPoint(elements.bases2[i].mesh, s2Pos, elements.baseTypes2[i]);
      
      const sb1 = createBondCylinder(s1Pos, baseAttach1, 0.08, bondColor);
      const sb2 = createBondCylinder(s2Pos, baseAttach2, 0.08, bondColor);
      dnaGroup.add(sb1);
      dnaGroup.add(sb2);
      elements.bondsSugarBase.push(sb1, sb2);
    }
    
    // Rebuild hydrogen bonds
    for (let i = 0; i < elements.bases1.length; i++) {
      const base1Center = elements.bases1[i].mesh.position;
      const base2Center = elements.bases2[i].mesh.position;
      const baseA = elements.baseTypes1[i];
      const hbonds = (baseA === 'A' || baseA === 'T') ? 2 : 3;
      
      for (let h = 0; h < hbonds; h++) {
        const points = getHydrogenBondPoints(base1Center, base2Center, h, hbonds);
        const hb = createBondCylinder(points.point1, points.point2, 0.08, 0xffffff);
        dnaGroup.add(hb);
        elements.bondsHydrogen.push(hb);
      }
    }
    
    // Rebuild phosphodiester bonds
    const bond5Color = 0x4fc3f7;
    const bond3Color = 0xff8a65;
    
    // Strand 1 phosphodiester bonds
    for (let i = 0; i < elements.phosphates1.length; i++) {
      const s1Pos = elements.sugars1[i].mesh.position;
      const s1NextPos = elements.sugars1[i + 1].mesh.position;
      const ph1Pos = elements.phosphates1[i].mesh.position;
      
      const b1 = createBondCylinder(s1Pos, ph1Pos, 0.08, bond5Color);
      const b2 = createBondCylinder(ph1Pos, s1NextPos, 0.08, bond3Color);
      dnaGroup.add(b1);
      dnaGroup.add(b2);
      elements.bondsSugarPhosphate.push(b1, b2);
    }
    
    // Strand 2 phosphodiester bonds
    for (let i = 0; i < elements.phosphates2.length; i++) {
      const j = elements.phosphates2[i].i;
      const s2Pos = elements.sugars2[j].mesh.position;
      const s2PrevPos = elements.sugars2[j - 1].mesh.position;
      const ph2Pos = elements.phosphates2[i].mesh.position;
      
      const b3 = createBondCylinder(s2Pos, ph2Pos, 0.08, bond5Color);
      const b4 = createBondCylinder(ph2Pos, s2PrevPos, 0.08, bond3Color);
      dnaGroup.add(b3);
      dnaGroup.add(b4);
      elements.bondsSugarPhosphate.push(b3, b4);
    }
  }

  function captureStarts() {
    unwind.starts.sugars1 = elements.sugars1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    unwind.starts.sugars2 = elements.sugars2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    unwind.starts.bases1 = elements.bases1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    unwind.starts.bases2 = elements.bases2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    unwind.starts.phosphates1 = elements.phosphates1.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
    unwind.starts.phosphates2 = elements.phosphates2.map(({ mesh }) => ({ pos: mesh.position.clone(), quat: mesh.quaternion.clone() }));
  }

  function startUnwindToPlane() {
    if (!dnaGroup || unwind.started || unwind.finished) return;
    autoRotate = false;
    computePlanarTargets();
    captureStarts();
    // also capture group rotation and target it to identity, so the ladder aligns with view axes
    unwind.groupStartQuat = dnaGroup.quaternion.clone();
    unwind.started = true;
    unwind.startTime = performance.now();
    // Prepare dynamic bonds (keep connectivity) and remove old bond meshes once replaced
    const tmpToRemove = [];
    const addDynamic = (mesh) => {
      mesh.material.transparent = false;
      mesh.material.opacity = 1.0;
      return mesh;
    };

    // Sugar→Base live bonds
    for (let i = 0; i < elements.bases1.length; i++) {
      const s1 = elements.sugars1[i].mesh.position.clone();
      const b1 = elements.bases1[i].mesh.position.clone();
      const m1 = addDynamic(createBondCylinder(s1, b1, 0.08, 0xa8a8a8));
      dnaGroup.add(m1);
      unwind.live.bondsSugarBase.push({ mesh: m1 });
    }
    for (let i = 0; i < elements.bases2.length; i++) {
      const s2 = elements.sugars2[i].mesh.position.clone();
      const b2 = elements.bases2[i].mesh.position.clone();
      const m2 = addDynamic(createBondCylinder(s2, b2, 0.08, 0xa8a8a8));
      dnaGroup.add(m2);
      unwind.live.bondsSugarBase.push({ mesh: m2 });
    }
    tmpToRemove.push(...elements.bondsSugarBase);
    elements.bondsSugarBase = [];

    // Strand 1 phosphodiester (sugar i → phosphate i → sugar i+1)
    for (let k = 0; k < elements.phosphates1.length; k++) {
      const i = k;
      const s5 = elements.sugars1[i].mesh.position.clone();
      const ph = elements.phosphates1[k].mesh.position.clone();
      const s3 = elements.sugars1[i + 1].mesh.position.clone();
      const b1 = addDynamic(createBondCylinder(s5, ph, 0.08, 0x9bdcf0));
      const b2 = addDynamic(createBondCylinder(ph, s3, 0.08, 0xf5b391));
      dnaGroup.add(b1); dnaGroup.add(b2);
      unwind.live.bondsPhospho1.push({ mesh: b1 });
      unwind.live.bondsPhospho1_3.push({ mesh: b2 });
    }

    // Strand 2 phosphodiester (sugar i → phosphate i → sugar i-1)
    for (let k = 0; k < elements.phosphates2.length; k++) {
      const i = elements.phosphates2[k].i;
      const s5 = elements.sugars2[i].mesh.position.clone();
      const ph = elements.phosphates2[k].mesh.position.clone();
      const s3 = elements.sugars2[i - 1].mesh.position.clone();
      const b1 = addDynamic(createBondCylinder(s5, ph, 0.08, 0x9bdcf0));
      const b2 = addDynamic(createBondCylinder(ph, s3, 0.08, 0xf5b391));
      dnaGroup.add(b1); dnaGroup.add(b2);
      unwind.live.bondsPhospho2.push({ mesh: b1 });
      unwind.live.bondsPhospho2_3.push({ mesh: b2 });
    }
    tmpToRemove.push(...elements.bondsSugarPhosphate);
    elements.bondsSugarPhosphate = [];

    // Hydrogen bonds (track offsets to keep parallel lines)
    // Now using hexagon centers instead of combined base centers
    for (let i = 0; i < elements.bases1.length; i++) {
      const kind = elements.basePairKinds[i] || 'AT';
      const hbonds = kind === 'AT' ? 2 : 3;
      
      // Get hexagon centers for both bases
      const baseType1 = elements.baseTypes1[i];
      const baseType2 = elements.baseTypes2[i];
      const hexCenter1 = getHexagonCenter(elements.bases1[i].mesh, baseType1);
      const hexCenter2 = getHexagonCenter(elements.bases2[i].mesh, baseType2);
      
      for (let h = 0; h < hbonds; h++) {
        const offset = (h - (hbonds - 1) / 2) * 0.3;
        const a = hexCenter1.clone();
        const b = hexCenter2.clone();
        a.z += offset; b.z += offset;
        const m = addDynamic(createBondCylinder(a, b, 0.08, 0xffffff));
        dnaGroup.add(m);
        unwind.live.bondsHydrogen.push({ mesh: m, i, offset });
      }
    }
    tmpToRemove.push(...elements.bondsHydrogen);
    elements.bondsHydrogen = [];

    // Remove the original static bonds (we use dynamic bonds henceforth)
    tmpToRemove.forEach(m => { if (m && m.parent) m.parent.remove(m); });
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeInQuad(t) {
    return t * t;
  }

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Additional easing functions for different animation styles
  const easingFunctions = {
    linear: (t) => t,
    easeInQuad,
    easeOutQuad,
    easeInOutQuad,
    easeInOutCubic,
    easeOutCubic,
    easeInCubic: (t) => t * t * t
  };

  // Camera animation state
  let cameraAnimation = {
    active: false,
    startTime: 0,
    duration: 1000, // milliseconds
    startCameraPos: new THREE.Vector3(),
    targetCameraPos: new THREE.Vector3(),
    startTargetPos: new THREE.Vector3(),
    targetTargetPos: new THREE.Vector3(),
    easing: easeInOutCubic
  };

  /**
   * Animates the camera position and controls target to new positions
   * @param {THREE.Vector3} newCameraPosition - Target camera position
   * @param {THREE.Vector3} newTargetPosition - Target controls target position
   * @param {number} duration - Animation duration in milliseconds (default: 1000)
   * @param {Function} easing - Easing function (default: easeInOutCubic)
   * @param {Function} onComplete - Callback function when animation completes
   */
  function animateCameraTo(newCameraPosition, newTargetPosition, duration = 1000, easing = easeInOutCubic, onComplete = null) {
    if (!camera || !controls) {
      console.warn('Camera or controls not initialized');
      return;
    }

    // Stop any existing animation
    cameraAnimation.active = false;

    // Set up new animation
    cameraAnimation.active = true;
    cameraAnimation.startTime = performance.now();
    cameraAnimation.duration = duration;
    cameraAnimation.easing = easing;
    cameraAnimation.onComplete = onComplete;

    // Capture current positions
    cameraAnimation.startCameraPos.copy(camera.position);
    cameraAnimation.targetCameraPos.copy(newCameraPosition);
    cameraAnimation.startTargetPos.copy(controls.target);
    cameraAnimation.targetTargetPos.copy(newTargetPosition);

    console.log('Starting camera animation:', {
      from: cameraAnimation.startCameraPos.toArray(),
      to: cameraAnimation.targetCameraPos.toArray(),
      duration: duration + 'ms'
    });
  }

  /**
   * Convenience function to animate camera to look at a specific point
   * @param {THREE.Vector3} lookAtPoint - Point to look at
   * @param {number} distance - Distance from the look-at point
   * @param {number} duration - Animation duration in milliseconds
   * @param {Function} onComplete - Callback when animation completes
   */
  function animateCameraToLookAt(lookAtPoint, distance = 100, duration = 1000, onComplete = null) {
    const cameraPos = new THREE.Vector3();
    cameraPos.copy(lookAtPoint);
    cameraPos.y += distance;
    
    animateCameraTo(cameraPos, lookAtPoint, duration, easingFunctions.easeInOutCubic, onComplete);
  }

  /**
   * Convenience function to zoom in/out from current position
   * @param {number} zoomFactor - Multiplier for current distance (1.0 = no change, 0.5 = zoom in, 2.0 = zoom out)
   * @param {number} duration - Animation duration in milliseconds
   * @param {Function} onComplete - Callback when animation completes
   */
  function animateCameraZoom(zoomFactor, duration = 800, onComplete = null) {
    const currentDirection = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    
    const currentDistance = camera.position.distanceTo(controls.target);
    const newDistance = currentDistance * zoomFactor;
    
    const newCameraPos = new THREE.Vector3()
      .copy(controls.target)
      .add(currentDirection.multiplyScalar(newDistance));
    
    animateCameraTo(newCameraPos, controls.target.clone(), duration, easingFunctions.easeInOutCubic, onComplete);
  }

  /**
   * Convenience function to orbit around the target point
   * @param {number} angleRadians - Angle to orbit in radians
   * @param {number} duration - Animation duration in milliseconds
   * @param {Function} onComplete - Callback when animation completes
   */
  function animateCameraOrbit(angleRadians, duration = 1200, onComplete = null) {
    const currentDirection = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    
    const currentDistance = camera.position.distanceTo(controls.target);
    
    // Convert to spherical coordinates, add angle, convert back
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(currentDirection);
    spherical.theta += angleRadians;
    
    const newDirection = new THREE.Vector3();
    newDirection.setFromSpherical(spherical);
    
    const newCameraPos = new THREE.Vector3()
      .copy(controls.target)
      .add(newDirection.multiplyScalar(currentDistance));
    
    animateCameraTo(newCameraPos, controls.target.clone(), duration, easingFunctions.easeInOutCubic, onComplete);
  }

  // Simple connection to the center of the base
  function getBaseSugarAttachmentPoint(baseMesh, sugarPos, baseType) {
    // Just return the base center - simple and clean
    return baseMesh.position.clone();
  }

  // Get the center of the hexagonal part of the base
  function getHexagonCenter(baseMesh, baseType) {
    if (baseType === 'A' || baseType === 'G') {
      // Purines have pentagon (children[0]) and hexagon (children[1])
      // Return the world position of the hexagon part
      if (baseMesh.children && baseMesh.children.length > 1) {
        const hexagonMesh = baseMesh.children[1]; // hexagon is second child
        const hexagonWorldPos = new THREE.Vector3();
        hexagonMesh.getWorldPosition(hexagonWorldPos);
        return hexagonWorldPos;
      }
    } else {
      // Pyrimidines (T, C) have only hexagon (children[0])
      if (baseMesh.children && baseMesh.children.length > 0) {
        const hexagonMesh = baseMesh.children[0]; // hexagon is first (and only) child
        const hexagonWorldPos = new THREE.Vector3();
        hexagonMesh.getWorldPosition(hexagonWorldPos);
        return hexagonWorldPos;
      }
    }
    
    // Fallback to base center if structure is unexpected
    return baseMesh.position.clone();
  }

  // Helper function to get hexagon vertices for hydrogen bonding
  function getHexagonVertices(baseMesh, baseType) {
    const sideLength = 1.2;
    const R = sideLength / (2 * Math.sin(Math.PI / 6)); // circumradius for hexagon
    const a = R * Math.cos(Math.PI / 6); // apothem
    
    let hexagonMesh;
    if (baseType === 'A' || baseType === 'G') {
      // Purines have hexagon as second child
      if (baseMesh.children && baseMesh.children.length > 1) {
        hexagonMesh = baseMesh.children[1];
      }
    } else {
      // Pyrimidines have hexagon as first child
      if (baseMesh.children && baseMesh.children.length > 0) {
        hexagonMesh = baseMesh.children[0];
      }
    }
    
    if (!hexagonMesh) {
      // Fallback to base center
      return [baseMesh.position.clone()];
    }
    
    // Get hexagon vertices in world coordinates
    const vertices = [];
    const theta0 = Math.PI / 2 - Math.PI / 6; // Starting angle for hexagon
    const step = 2 * Math.PI / 6;
    
    for (let k = 0; k < 6; k++) {
      const t = theta0 + k * step;
      const x = R * Math.cos(t);
      const y = -a + R * Math.sin(t); // Center below edge for hexagon
      const z = 0;
      
      // Create local vertex position
      const localVertex = new THREE.Vector3(x, y, z);
      
      // Transform to world coordinates
      const worldVertex = new THREE.Vector3();
      hexagonMesh.localToWorld(localVertex, worldVertex);
      vertices.push(worldVertex);
    }
    
    return vertices;
  }

  // Helper function to get prong end coordinates for hydrogen bonding
  function getProngEndCoordinates(baseMesh, baseType) {
    const sideLength = 1.2;
    const prongLength = 0.6;
    const thickness = 0.25;
    
    // Get prong vertices from the existing function
    const prongVertices = getProngVertices(baseType, sideLength);
    const prongEnds = [];
    
    prongVertices.forEach(vertex => {
      // Calculate the direction vector from the vertex angle
      const direction = new THREE.Vector3(
        Math.cos(vertex.angle), 
        0, 
        Math.sin(vertex.angle)
      );
      
      // Position at the vertex
      const vertexPos = new THREE.Vector3(vertex.x, thickness/2, vertex.z);
      
      // Move outward by prong length
      const prongEnd = vertexPos.clone().add(direction.multiplyScalar(prongLength));
      
      // Transform to world coordinates
      const worldProngEnd = new THREE.Vector3();
      baseMesh.localToWorld(prongEnd, worldProngEnd);
      prongEnds.push(worldProngEnd);
    });
    
    return prongEnds;
  }

  // Function to create A-T hydrogen bonds (2 bonds)
  function createATHydrogenBonds(baseMesh1, baseMesh2, baseType1, baseType2) {
    const sideLength = 1.2;
    const prongLength = 0.6;

    const bonds = [];
    let hexagonCenter1 = baseMesh1.position.clone();
    let hexagonCenter2 = baseMesh2.position.clone();
    let prongEnd1 = baseMesh1.position.clone();
    let prongEnd2 = baseMesh2.position.clone();
    if(baseType1 === 'A' || baseType1 === 'G') {
      hexagonCenter1 = baseMesh1.position.clone().add(new THREE.Vector3(0.8+0.1, 0, 0.45));    
    }
    prongEnd1 = hexagonCenter1.clone().add(new THREE.Vector3((sideLength + prongLength) * Math.cos(Math.PI/3) + 0.1, 0, -(sideLength + prongLength) * Math.sin(Math.PI/3)))
    if(baseType2 === 'A' || baseType2 === 'G') {
      hexagonCenter2 = baseMesh2.position.clone().add(new THREE.Vector3(-0.8-0.1, 0, 0.45));      
    }
    prongEnd2 = hexagonCenter2.clone().add(new THREE.Vector3(-(sideLength + prongLength) * Math.cos(Math.PI/3) - 0.1, 0, -(sideLength + prongLength) * Math.sin(Math.PI/3)))
    
    bonds.push({
      start: hexagonCenter1,
      end: hexagonCenter2,
      type: 'hexagon-hexagon'
    });
    bonds.push({
      start: prongEnd1,
      end: prongEnd2,
      type: 'prong-prong'
    });
    return bonds;
  }

  // Function to create G-C hydrogen bonds (3 bonds)
  function createGCHydrogenBonds(baseMesh1, baseMesh2, baseType1, baseType2) {
    const sideLength = 1.2;
    const prongLength = 0.6;

    const bonds = [];
    let hexagonCenter1 = baseMesh1.position.clone();
    let hexagonCenter2 = baseMesh2.position.clone();
    let prong1End1 = baseMesh1.position.clone();
    let prong1End2 = baseMesh2.position.clone();
    let prong2End1 = baseMesh1.position.clone();
    let prong2End2 = baseMesh2.position.clone();
    if(baseType1 === 'A' || baseType1 === 'G') {
      hexagonCenter1 = baseMesh1.position.clone().add(new THREE.Vector3(0.8+0.1, 0, 0.45));    
    }
    prong1End1 = hexagonCenter1.clone().add(new THREE.Vector3((sideLength + prongLength) * Math.cos(Math.PI/3) + 0.1, 0, -(sideLength + prongLength) * Math.sin(Math.PI/3)))
    prong2End1 = hexagonCenter1.clone().add(new THREE.Vector3((sideLength + prongLength) * Math.cos(Math.PI/3) + 0.1, 0, (sideLength + prongLength) * Math.sin(Math.PI/3)))

    if(baseType2 === 'A' || baseType2 === 'G') {
      hexagonCenter2 = baseMesh2.position.clone().add(new THREE.Vector3(-0.8-0.1, 0, 0.45));      
    }
    prong1End2 = hexagonCenter2.clone().add(new THREE.Vector3(-(sideLength + prongLength) * Math.cos(Math.PI/3) - 0.1, 0, -(sideLength + prongLength) * Math.sin(Math.PI/3)))
    prong2End2 = hexagonCenter2.clone().add(new THREE.Vector3(-(sideLength + prongLength) * Math.cos(Math.PI/3) - 0.1, 0, (sideLength + prongLength) * Math.sin(Math.PI/3)))
    
    bonds.push({
      start: hexagonCenter1,
      end: hexagonCenter2,
      type: 'hexagon-hexagon'
    });
    bonds.push({
      start: prong1End1,
      end: prong1End2,
      type: 'prong-prong'
    });
    bonds.push({
      start: prong2End1,
      end: prong2End2,
      type: 'prong-prong'
    });    
    return bonds;
  }


  // Simplified hydrogen bond points - just connect base centers with offset for multiple bonds
  function getHydrogenBondPoints(baseCenter1, baseCenter2, bondIndex, totalBonds) {
    // Add small offset to separate multiple bonds visually
    const offset = (bondIndex - (totalBonds - 1) / 2) * 0.3;
    const offsetVector = new THREE.Vector3(0, 0, offset);
    
    const point1 = baseCenter1.clone().add(offsetVector);
    const point2 = baseCenter2.clone().add(offsetVector);
    
    return { point1, point2 };
  }

  // Simplified sugar connection points - just use offsets from center
  function getSugarConnectionPoints(sugarPos) {
        return { 
      fivePrime: sugarPos.clone().add(new THREE.Vector3(1.2, 0, 0)),
      threePrime: sugarPos.clone().add(new THREE.Vector3(-1.2, 0, 0)),
      base: sugarPos.clone().add(new THREE.Vector3(0, 0, 1.2))
    };
  }

  function orientSugar(mesh, theta, rollOffset = Math.PI / 10, tilt = Math.PI / 15) {
    const inward = new THREE.Vector3(-Math.cos(theta), -Math.sin(theta), 0).normalize();
    const tangent = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0).normalize();
    const binormal = new THREE.Vector3().crossVectors(inward, tangent).normalize();
    const m = new THREE.Matrix4();
    m.makeBasis(tangent, binormal, inward); // local X=tangent, Y=binormal, Z=inward
    mesh.setRotationFromMatrix(m);
    // Roll around local inward so polygon orientation reveals distinct vertices
    mesh.rotateOnAxis(new THREE.Vector3(0, 0, 1), rollOffset);
    // Slight tilt around local tangent to expose bonds visually
    mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), tilt);
  }

  // Function to create a small cylindrical prong with colored sphere at the end
  function createProng(type) {
    const prongRadius = 0.08;
    const prongLength = 0.6;
    // const prongColor = 0xFFD700; // Gold color for prongs
    const colors = { A: 0x4CAF50, T: 0xF0C33C, G: 0x3C86F0, C: 0xD9534F };
    const prongColor = colors[type] || 0xFFFFFF; // Default to white if type not found
    
    // Create the main prong group
    const prongGroup = new THREE.Group();
    
    // Create the cylindrical prong
    const geometry = new THREE.CylinderGeometry(prongRadius, prongRadius, prongLength, 8);
    const material = new THREE.MeshStandardMaterial({ color: prongColor, roughness: 0.2, metalness: 0.3 });
    const prong = new THREE.Mesh(geometry, material);
    
    // Create the colored sphere at the end
    const sphereRadius = 0.2;
    const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 8, 6);    
    const sphereMaterial = new THREE.MeshStandardMaterial({ 
      color: prongColor, 
      roughness: 0.2, 
      metalness: 0.3 
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    
    // Position the sphere at the end of the prong
    sphere.position.y = -prongLength / 2 - sphereRadius*0.25;
    
    // Add both to the group
    prongGroup.add(prong);
    prongGroup.add(sphere);
    
    return prongGroup;
  }

  // Function to get vertex positions for prongs based on base type
  function getProngVertices(type, sideLength) {
    const vertices = [];
    const R = sideLength / (2 * Math.sin(Math.PI / 6));
    const D = sideLength / (2 * Math.tan(Math.PI / 6));
    
    // Based on the createRegularPrismWithTopEdge function for hexagon (n=6)
    // The vertices are positioned with theta0 = Math.PI/2 - Math.PI/6 = Math.PI/3
    // And step = 2*Math.PI/6 = Math.PI/3
    
    if (type === 'A') {      
      vertices.push({ x: -R, z: -D, angle: -6*Math.PI/6});
    } else if (type === 'T') {            
      vertices.push({ x: -R * 0.866, z: -R * 0.5, angle: -5*Math.PI/6 });
      vertices.push({ x: R * 0.866, z: -R * 0.5, angle: -Math.PI/6 });
      vertices.push({ x: -R * 0.866, z: R * 0.5, angle: -7*Math.PI/6 });
    } else if (type === 'G') {      
      vertices.push({ x: -R, z: -D, angle: -6*Math.PI/6});
      vertices.push({ x: sideLength*0.5, z: -2*D, angle: -2*Math.PI/6});
    } else if (type === 'C') {      
      vertices.push({ x: -R * 0.866, z: -R * 0.5, angle: -5*Math.PI/6 });
      vertices.push({ x: R * 0.866, z: -R * 0.5, angle: -Math.PI/6 });
    }
    
    return vertices;
  }

  // Function to add prongs to a base group
  function addProngsToBase(baseGroup, type, addProng = false) {
    if (!addProng || state.step !== 4) return;
    
    const sideLength = 1.2;
    const prongVertices = getProngVertices(type, sideLength);
    const thickness = 0.25;
    const prongLength = 0.6;
    
    prongVertices.forEach(vertex => {
      const prong = createProng(type);
      
      // Use the angle from the vertex instead of calculating direction
      const direction = new THREE.Vector2(Math.cos(vertex.angle), Math.sin(vertex.angle));
      
      // Position prong at the vertex
      prong.position.set(vertex.x, 0, vertex.z);
      
      // Move prong outward by half its length so it extends from the vertex
      prong.position.x += direction.x * prongLength/2.5;
      prong.position.z += direction.y * prongLength/2.5;
      
      // Rotate prong to point outward from the vertex using the vertex angle
      // The prong cylinder is initially oriented along Y-axis, we need to rotate it to point outward
      prong.rotation.y = -vertex.angle; // Rotate around Y-axis to align with outward direction
      prong.rotation.z = Math.PI/2; // Rotate to make it horizontal
      
      baseGroup.add(prong);
    });
  }

  // Function to add prongs to all existing bases
  function addProngsToAllBases() {
    if (state.step !== 4 || !elements.bases1 || !elements.bases2) return;
    
    // Add prongs to strand 1 bases
    elements.bases1.forEach((baseObj, i) => {
      const baseType = elements.baseTypes1[i];
      addProngsToBase(baseObj.mesh, baseType, true);
    });
    
    // Add prongs to strand 2 bases
    elements.bases2.forEach((baseObj, i) => {
      const baseType = elements.baseTypes2[i];
      addProngsToBase(baseObj.mesh, baseType, true);
    });
  }

  function createBaseByType(type, addProng = false) {
    const colors = { A: 0x4CAF50, T: 0xF0C33C, G: 0x3C86F0, C: 0xD9534F };
    const group = new THREE.Group();
    const thickness = 0.25;
  
    if (type === 'A' || type === 'G') {
      // choose the common side length s (for a hexagon, s == R_hex)
      const s = 1.2;
  
      // Hexagon below the edge (edge is its "top" side)
      const hex = createRegularPrismWithTopEdge(6, s, thickness, colors[type], false);
  
      // Pentagon above the edge (edge is its "bottom" side)
      const pent = createRegularPrismWithTopEdge(5, s, thickness, colors[type], true);
  
      // They already share the edge at y=0, no rotations/offsets needed
      group.add(pent);
      group.add(hex);
    } else {
      // Single pyrimidine ring (hexagon) — same helper keeps orientation consistent
      const s = 1.2;
      const hex = createHexagonPrism(s, thickness, colors[type]);
      group.add(hex);
    }
  
    // Add prongs if requested and in step 4
    addProngsToBase(group, type, addProng);
  
    return group;
  }
  

  function buildDNAHelix() {
    dnaGroup = new THREE.Group();

    const numPairs = 50; // visible chunk
    numPairsGlobal = numPairs;
    const helixRadius = 5.0; // backbone radius
    const risePerBase = 3.6; // distance along z between successive base pairs
    const twistPerBase = (3 * Math.PI) / 10.0; // ~10 bp per turn
    const backboneOffsetOut = 0.9; // how far phosphate sits outside sugar
    const baseDistanceFromAxis = -2.0; // Increased distance to reduce overlap

    const sugarSize = 1.2;
    const phosphateRadius = 0.7;
    const bondColor = 0x888888; // darker gray for sugar-base bonds
    const bond5Color = 0x4fc3f7; // brighter cyan for 5' link
    const bond3Color = 0xff8a65; // brighter orange for 3' link

    // Simple repeating sequence with complement mapping
    const sequence = ['A', 'T', 'G', 'C', 'A', 'T', 'G'];
    const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };

    const sugars1 = []; 
    const sugars2 = [];

    for (let i = 0; i < numPairs; i++) {
      const theta = i * twistPerBase;
      const z = i * risePerBase;

      // Strand 1 (angle = theta)
      const s1Angle = theta;
      const s1SugarPos = new THREE.Vector3(
        Math.cos(s1Angle) * helixRadius,
        Math.sin(s1Angle) * helixRadius,
        z
      );
      // defer phosphate placement until we know neighbor sugar

      // Strand 2 (opposite angle)
      const s2Angle = theta + Math.PI;
      const s2SugarPos = new THREE.Vector3(
        Math.cos(s2Angle) * helixRadius,
        Math.sin(s2Angle) * helixRadius,
        z
      );
      // defer phosphate placement until we know neighbor sugar

      // SUGARS (pentagons)
      const sugarMaterialColor = 0xdedede;
      const thickness = 0.25;
      const sugar1 = createPentagonPrism(sugarSize, thickness, sugarMaterialColor);
      sugar1.position.copy(s1SugarPos);
      const s1Roll = Math.PI; const s1Tilt = 0;
      const s2Roll = -Math.PI; const s2Tilt = 0;

      orientSugar(sugar1, s1Angle, s1Roll, s1Tilt);
      dnaGroup.add(sugar1);
      elements.sugars1.push({ mesh: sugar1 });
      sugars1.push(s1SugarPos.clone());

      const sugar2 = createPentagonPrism(sugarSize, thickness, sugarMaterialColor);
      sugar2.position.copy(s2SugarPos);      
      orientSugar(sugar2, s2Angle, s2Roll, s2Tilt);
      dnaGroup.add(sugar2);
      elements.sugars2.push({ mesh: sugar2 });
      sugars2.push(s2SugarPos.clone());

      // phosphates and bonds will be added after the loop for cleaner topology

      // BASES
      const baseA = sequence[i % sequence.length];
      const baseB = complement[baseA];

      const inward1 = s1SugarPos.clone().multiplyScalar(-1).setZ(0);
      inward1.normalize();
      const inward2 = s2SugarPos.clone().multiplyScalar(-1).setZ(0);
      inward2.normalize();      

      const base1Center = new THREE.Vector3(
        inward1.x * baseDistanceFromAxis,
        inward1.y * baseDistanceFromAxis,
        z
      );
      const base2Center = new THREE.Vector3(
        inward2.x * baseDistanceFromAxis,
        inward2.y * baseDistanceFromAxis,
        z
      );

      const base1 = createBaseByType(baseA);
      base1.position.copy(base1Center);
      // Orient base1 to face base2 - rotate so the flat face (XZ plane) faces base2
      const dirToBase2 = new THREE.Vector3().subVectors(base2Center, base1Center).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, dirToBase2).normalize();
      const forward = new THREE.Vector3().crossVectors(right, up).normalize();
      const matrix1 = new THREE.Matrix4().makeBasis(right, up, forward);
      base1.setRotationFromMatrix(matrix1);
      
      // Add slight rotation to better match the image orientation
      // Rotate around the local Y axis to tilt the base slightly
      const tiltRotation = new THREE.Matrix4().makeRotationY(Math.PI * 0.1); // Small tilt
      matrix1.premultiply(tiltRotation);
      base1.setRotationFromMatrix(matrix1);
      dnaGroup.add(base1);
      elements.bases1.push({ mesh: base1 });
      elements.baseTypes1.push(baseA);

      const base2 = createBaseByType(baseB);
      base2.position.copy(base2Center);
      // Orient base2 to face base1 - rotate so the flat face (XZ plane) faces base1
      const dirToBase1 = new THREE.Vector3().subVectors(base1Center, base2Center).normalize();
      const right2 = new THREE.Vector3().crossVectors(up, dirToBase1).normalize();
      const forward2 = new THREE.Vector3().crossVectors(right2, up).normalize();
      const matrix2 = new THREE.Matrix4().makeBasis(right2, up, forward2);
      base2.setRotationFromMatrix(matrix2);
      
      // Add slight rotation to better match the image orientation
      // Rotate around the local Y axis to tilt the base slightly
      const tiltRotation2 = new THREE.Matrix4().makeRotationY(-Math.PI * 0.1); // Small tilt in opposite direction
      matrix2.premultiply(tiltRotation2);
      base2.setRotationFromMatrix(matrix2);
      dnaGroup.add(base2);
      elements.bases2.push({ mesh: base2 });
      elements.baseTypes2.push(baseB);

      // Simple bonds from sugar centers to base surfaces
      const baseAttach1 = getBaseSugarAttachmentPoint(base1, s1SugarPos, baseA);
      const baseAttach2 = getBaseSugarAttachmentPoint(base2, s2SugarPos, baseB);
      const sb1 = createBondCylinder(s1SugarPos, baseAttach1, 0.08, bondColor);
      const sb2 = createBondCylinder(s2SugarPos, baseAttach2, 0.08, bondColor);
      dnaGroup.add(sb1);
      dnaGroup.add(sb2);
      elements.bondsSugarBase.push(sb1, sb2);

      // Simple hydrogen bonds between base centers (2 for A-T, 3 for G-C)
      const hbonds = (baseA === 'A' || baseA === 'T') ? 2 : 3;
      elements.basePairKinds.push((baseA === 'A' || baseA === 'T') ? 'AT' : 'GC');
      for (let h = 0; h < hbonds; h++) {
        const points = getHydrogenBondPoints(base1Center, base2Center, h, hbonds);
        const hb = createBondCylinder(points.point1, points.point2, 0.08, 0xffffff);
        dnaGroup.add(hb);
        elements.bondsHydrogen.push(hb);
      }
    }

    // Place phosphates at clean positions relative to adjacent sugars, then add bonds
    const phosphateColor = 0x9c9c9c;

    const phosphates1 = [];
    const phosphates2 = [];

    for (let i = 0; i < numPairs; i++) {
      // On each strand, place phosphate near the midpoint between sugar i and its 3' neighbor sugar
      const hasNext1 = i < numPairs - 1;
      const hasPrev2 = i > 0; // for antiparallel strand 2

      const s1 = sugars1[i];
      const s2 = sugars2[i];

      if (hasNext1) {
        const s1next = sugars1[i + 1];
        const mid1 = new THREE.Vector3().addVectors(s1, s1next).multiplyScalar(0.5);
        const out1 = new THREE.Vector3(mid1.x, mid1.y, 0).normalize().multiplyScalar(0.9);
        const phosPos1 = mid1.clone().add(out1);
        const phos1 = createPhosphateSphere(phosphateRadius, phosphateColor);
        phos1.position.copy(phosPos1);
        dnaGroup.add(phos1);
        phosphates1.push(phosPos1);
        elements.phosphates1.push({ mesh: phos1, i });
        // Simple bonds from sugar centers to phosphate and phosphate to next sugar
        const b1 = createBondCylinder(s1, phosPos1, 0.08, bond5Color);
        const b2 = createBondCylinder(phosPos1, s1next, 0.08, bond3Color);
        dnaGroup.add(b1);
        dnaGroup.add(b2);
        elements.bondsSugarPhosphate.push(b1, b2);
      }

      if (hasPrev2) {
        const s2prev = sugars2[i - 1];
        const mid2 = new THREE.Vector3().addVectors(s2, s2prev).multiplyScalar(0.5);
        const out2 = new THREE.Vector3(mid2.x, mid2.y, 0).normalize().multiplyScalar(0.9);
        const phosPos2 = mid2.clone().add(out2);
        const phos2 = createPhosphateSphere(phosphateRadius, phosphateColor);
        phos2.position.copy(phosPos2);
        dnaGroup.add(phos2);
        phosphates2.push(phosPos2);
        elements.phosphates2.push({ mesh: phos2, i });
        // Simple bonds from sugar centers to phosphate and phosphate to previous sugar
        const b3 = createBondCylinder(s2, phosPos2, 0.08, bond5Color);
        const b4 = createBondCylinder(phosPos2, s2prev, 0.08, bond3Color);
        dnaGroup.add(b3);
        dnaGroup.add(b4);
        elements.bondsSugarPhosphate.push(b3, b4);        
      }
    }

    // Subtle overall rotation for aesthetics
    dnaGroup.rotation.z = Math.PI * 0.05;
    scene.add(dnaGroup);
  }

  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    
    // Handle camera animation
    if (cameraAnimation.active) {
      const now = performance.now();
      const elapsed = now - cameraAnimation.startTime;
      const t = Math.min(elapsed / cameraAnimation.duration, 1);
      const easedT = cameraAnimation.easing(t);

      // Interpolate camera position
      camera.position.copy(cameraAnimation.startCameraPos)
        .lerp(cameraAnimation.targetCameraPos, easedT);

      // Interpolate controls target
      controls.target.copy(cameraAnimation.startTargetPos)
        .lerp(cameraAnimation.targetTargetPos, easedT);

      // Update controls to apply the new target
      controls.update();

      // Check if animation is complete
      if (t >= 1) {
        cameraAnimation.active = false;
        if (cameraAnimation.onComplete) {
          cameraAnimation.onComplete();
        }
        console.log('Camera animation completed');
      }
    }

    if (dnaGroup) {
      if (autoRotate) {
        dnaGroup.rotation.z += 0.005; // slow turn to showcase shape
      }
      if (unwind.started && !unwind.finished) {
        const now = performance.now();
        const tNorm = Math.min(1, (now - unwind.startTime) / unwind.durationMs);
        const e = (tNorm < 0.5) ? 4 * tNorm * tNorm * tNorm : 1 - Math.pow(-2 * tNorm + 2, 3) / 2;

        const lerpSet = (arr, starts, targets) => {
          for (let i = 0; i < arr.length; i++) {
            const mesh = arr[i].mesh;
            const s = starts[i];
            const tg = targets[i];
            mesh.position.copy(s.pos).lerp(tg.pos, e);
            mesh.quaternion.copy(s.quat).slerp(tg.quat, e);
          }
        };
        lerpSet(elements.sugars1, unwind.starts.sugars1, unwind.targets.sugars1);
        lerpSet(elements.sugars2, unwind.starts.sugars2, unwind.targets.sugars2);
        lerpSet(elements.bases1, unwind.starts.bases1, unwind.targets.bases1);
        lerpSet(elements.bases2, unwind.starts.bases2, unwind.targets.bases2);
        lerpSet(elements.phosphates1, unwind.starts.phosphates1, unwind.targets.phosphates1);
        lerpSet(elements.phosphates2, unwind.starts.phosphates2, unwind.targets.phosphates2);

        // Slerp the overall group rotation back to identity to match planar layout to view
        if (unwind.groupStartQuat) {
          const q = unwind.groupStartQuat.clone().slerp(unwind.groupTargetQuat, e);
          dnaGroup.setRotationFromQuaternion(q);
        }

        // Update dynamic bonds so connectivity persists during unwind
        // Sugar→Base - connections to actual base surfaces accounting for orientation
        for (let i = 0; i < elements.bases1.length; i++) {
          const sugarPos1 = elements.sugars1[i].mesh.position;
          const baseMesh1 = elements.bases1[i].mesh;
          const baseType1 = elements.baseTypes1[i];
          const baseAttach1 = getBaseSugarAttachmentPoint(baseMesh1, sugarPos1, baseType1);
          
          const msb1 = unwind.live.bondsSugarBase[i * 2 + 0].mesh;
          msb1.geometry.dispose();
          msb1.geometry = new THREE.CylinderGeometry(0.08, 0.08, sugarPos1.distanceTo(baseAttach1), 12);
          const mid1 = new THREE.Vector3().addVectors(sugarPos1, baseAttach1).multiplyScalar(0.5);
          msb1.position.copy(mid1);
          msb1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(baseAttach1, sugarPos1).normalize());
        }
        for (let i = 0; i < elements.bases2.length; i++) {
          const sugarPos2 = elements.sugars2[i].mesh.position;
          const baseMesh2 = elements.bases2[i].mesh;
          const baseType2 = elements.baseTypes2[i];
          const baseAttach2 = getBaseSugarAttachmentPoint(baseMesh2, sugarPos2, baseType2);
          
          const msb2 = unwind.live.bondsSugarBase[i * 2 + 1].mesh;
          msb2.geometry.dispose();
          msb2.geometry = new THREE.CylinderGeometry(0.08, 0.08, sugarPos2.distanceTo(baseAttach2), 12);
          const mid2 = new THREE.Vector3().addVectors(sugarPos2, baseAttach2).multiplyScalar(0.5);
          msb2.position.copy(mid2);
          msb2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(baseAttach2, sugarPos2).normalize());
        }

        // Strand 1 phosphodiester - simple center-to-center connections
        for (let k = 0; k < elements.phosphates1.length; k++) {
          const i = k;
          const sugarPos1 = elements.sugars1[i].mesh.position;
          const sugarPosNext1 = elements.sugars1[i + 1].mesh.position;
          const ph = elements.phosphates1[k].mesh.position;
          
          const b1 = unwind.live.bondsPhospho1[k].mesh;
          const b2 = unwind.live.bondsPhospho1_3[k].mesh;
          b1.geometry.dispose(); b2.geometry.dispose();
          b1.geometry = new THREE.CylinderGeometry(0.08, 0.08, sugarPos1.distanceTo(ph), 12);
          b2.geometry = new THREE.CylinderGeometry(0.08, 0.08, ph.distanceTo(sugarPosNext1), 12);
          const midA = new THREE.Vector3().addVectors(sugarPos1, ph).multiplyScalar(0.5);
          const midB = new THREE.Vector3().addVectors(ph, sugarPosNext1).multiplyScalar(0.5);
          b1.position.copy(midA); b2.position.copy(midB);
          b1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(ph, sugarPos1).normalize());
          b2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(sugarPosNext1, ph).normalize());
        }

        // Strand 2 phosphodiester - simple center-to-center connections
        for (let k = 0; k < elements.phosphates2.length; k++) {
          const i = elements.phosphates2[k].i;
          const sugarPos2 = elements.sugars2[i].mesh.position;
          const sugarPosPrev2 = elements.sugars2[i - 1].mesh.position;
          const ph = elements.phosphates2[k].mesh.position;
          
          const b1 = unwind.live.bondsPhospho2[k].mesh;
          const b2 = unwind.live.bondsPhospho2_3[k].mesh;
          b1.geometry.dispose(); b2.geometry.dispose();
          b1.geometry = new THREE.CylinderGeometry(0.08, 0.08, sugarPos2.distanceTo(ph), 12);
          b2.geometry = new THREE.CylinderGeometry(0.08, 0.08, ph.distanceTo(sugarPosPrev2), 12);
          const midA = new THREE.Vector3().addVectors(sugarPos2, ph).multiplyScalar(0.5);
          const midB = new THREE.Vector3().addVectors(ph, sugarPosPrev2).multiplyScalar(0.5);
          b1.position.copy(midA); b2.position.copy(midB);
          b1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(ph, sugarPos2).normalize());
          b2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(sugarPosPrev2, ph).normalize());
        }

        // Hydrogen bonds - using hexagon centers instead of combined base centers
        let idx = 0;
        for (let i = 0; i < numPairsGlobal; i++) {
          const kind = elements.basePairKinds[i] || 'AT';
          const hb = kind === 'AT' ? 2 : 3;
          
          // Get hexagon centers for both bases
          const baseType1 = elements.baseTypes1[i];
          const baseType2 = elements.baseTypes2[i];
          const hexCenter1 = getHexagonCenter(elements.bases1[i].mesh, baseType1);
          const hexCenter2 = getHexagonCenter(elements.bases2[i].mesh, baseType2);
          
          for (let h = 0; h < hb; h++) {
            const { mesh } = unwind.live.bondsHydrogen[idx++];
            
            // Apply offset to hexagon centers
            const offset = (h - (hb - 1) / 2) * 0.3;
            const a = hexCenter1.clone();
            const b = hexCenter2.clone();
            a.z += offset; b.z += offset;
            
            mesh.geometry.dispose();
            mesh.geometry = new THREE.CylinderGeometry(0.06, 0.06, a.distanceTo(b), 12);
            const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
            mesh.position.copy(mid);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
          }
        }

        if (tNorm >= 1) {
          unwind.started = false;
          unwind.finished = true;
          // keep dynamic bonds as final bonds; nothing to rebuild
          // Create labels now that unwinding is complete
          createLabelsForElements();
        }
      }

      // Handle expansion animation (step 4)
      if (expansion.started && !expansion.finished) {
        const now = performance.now();
        const tNorm = Math.min(1, (now - expansion.startTime) / expansion.durationMs);
        const e = easeInOutCubic(tNorm); // Smooth easing for expansion

        const lerpSet = (arr, starts, targets) => {
          for (let i = 0; i < arr.length; i++) {
            const mesh = arr[i].mesh;
            const s = starts[i];
            const tg = targets[i];
            mesh.position.copy(s.pos).lerp(tg.pos, e);
            mesh.quaternion.copy(s.quat).slerp(tg.quat, e);
          }
        };

        // Animate all elements to their expanded positions
        lerpSet(elements.sugars1, expansion.starts.sugars1, expansion.targets.sugars1);
        lerpSet(elements.sugars2, expansion.starts.sugars2, expansion.targets.sugars2);
        lerpSet(elements.bases1, expansion.starts.bases1, expansion.targets.bases1);
        lerpSet(elements.bases2, expansion.starts.bases2, expansion.targets.bases2);
        lerpSet(elements.phosphates1, expansion.starts.phosphates1, expansion.targets.phosphates1);
        lerpSet(elements.phosphates2, expansion.starts.phosphates2, expansion.targets.phosphates2);        

        if (tNorm >= 1) {
          expansion.started = false;
          expansion.finished = true;
          addProngsToAllBases();
          renderExpandedBonds();                    
          console.log('Structure expansion completed');
        }
      }
    }
    
    // Update label positions and orientations if they're visible
    updateLabelPositions();
    
    controls.update();
    renderer.render(scene, camera);
  }

  // ----- Interaction: drag DNA to orbit or spin -----
  function screenToNDC(event, element) {
    const rect = element.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ndcPointer.set(x, y);
  }

  function intersectsDNA() {
    if (!dnaGroup) return false;
    raycaster.setFromCamera(ndcPointer, camera);
    const hits = raycaster.intersectObject(dnaGroup, true);
    return hits.length > 0;
  }

  function onPointerDown(event) {
    if (!renderer || !camera) return;
    if (event.button !== 0) return; // left only
    screenToNDC(event, renderer.domElement);
    if (!intersectsDNA()) return;
    isDraggingDNA = true;
    previousPointer.x = event.clientX;
    previousPointer.y = event.clientY;
    controls.enabled = false; // avoid conflicts while custom-dragging
    renderer.domElement.style.cursor = 'grabbing';
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!isDraggingDNA) return;
    const dx = event.clientX - previousPointer.x;
    const dy = event.clientY - previousPointer.y;
    previousPointer.x = event.clientX;
    previousPointer.y = event.clientY;

    const element = renderer.domElement;
    const width = element.clientWidth || 1;
    const height = element.clientHeight || 1;
    const deltaX = dx / width;
    const deltaY = dy / height;
    // spin around central helix axis (world Z) on normal drag;
    // holding Shift increases spin speed
    if (dnaGroup) {
      const baseSpeed = 2.5 * Math.PI; // radians per full drag width
      const speed = (event.shiftKey ? 4.0 : 1.0) * baseSpeed;
      dnaGroup.rotateZ(-deltaX * speed);
    }
  }

  function onPointerUpOrLeave() {
    if (!isDraggingDNA) return;
    isDraggingDNA = false;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
  }

  function toggleRailsVisualization() {
    console.log('toggleRailsVisualization called');
    const railsBtn = document.getElementById('btn-visualise-rails');
    const rungsBtn = document.getElementById('btn-visualise-rungs');
    const isActive = railsBtn.classList.contains('inst-btn-active');
    
    console.log('Rails button active:', isActive);
    
    if (isActive) {
      // Turn off rails visualization - show all elements at full opacity
      railsBtn.classList.remove('inst-btn-active');
      railsBtn.setAttribute('aria-pressed', 'false');
      console.log('Showing all elements at full opacity');
      showAllElementsAtFullOpacity();
    } else {
      // Turn on rails visualization - highlight rails, dim rungs
      railsBtn.classList.add('inst-btn-active');
      railsBtn.setAttribute('aria-pressed', 'true');
      
      // Deactivate rungs button
      rungsBtn.classList.remove('inst-btn-active');
      rungsBtn.setAttribute('aria-pressed', 'false');
      
      console.log('Highlighting rails, dimming rungs');
      showRailsElements(true);
      showRungsElements(false);
    }
  }

  function toggleRungsVisualization() {
    console.log('toggleRungsVisualization called');
    const railsBtn = document.getElementById('btn-visualise-rails');
    const rungsBtn = document.getElementById('btn-visualise-rungs');
    const isActive = rungsBtn.classList.contains('inst-btn-active');
    
    console.log('Rungs button active:', isActive);
    
    if (isActive) {
      // Turn off rungs visualization - show all elements at full opacity
      rungsBtn.classList.remove('inst-btn-active');
      rungsBtn.setAttribute('aria-pressed', 'false');
      console.log('Showing all elements at full opacity');
      showAllElementsAtFullOpacity();
    } else {
      // Turn on rungs visualization - highlight rungs, dim rails
      rungsBtn.classList.add('inst-btn-active');
      rungsBtn.setAttribute('aria-pressed', 'true');
      
      // Deactivate rails button
      railsBtn.classList.remove('inst-btn-active');
      railsBtn.setAttribute('aria-pressed', 'false');
      
      console.log('Highlighting rungs, dimming rails');
      showRailsElements(false);
      showRungsElements(true);
    }
  }

  function setElementOpacity(mesh, opacity) {
    if (!mesh) return;
    
    // Handle Three.js Groups (like bases which are groups of meshes)
    if (mesh.isGroup || mesh.type === 'Group') {
      mesh.children.forEach(child => {
        setElementOpacity(child, opacity);
      });
      return;
    }
    
    // Handle regular meshes with materials
    if (mesh.material) {
      // Handle both single materials and arrays of materials
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(material => {
          material.transparent = opacity < 1.0;
          material.opacity = opacity;
          material.needsUpdate = true; // Force material update
        });
      } else {
        mesh.material.transparent = opacity < 1.0;
        mesh.material.opacity = opacity;
        mesh.material.needsUpdate = true; // Force material update
      }
    }
  }

  function showRailsElements(show) {
    if (!dnaGroup) return;
    
    const opacity = show ? 1.0 : 0.3;
    console.log(`showRailsElements: show=${show}, opacity=${opacity}`);
    
    // Adjust opacity of sugar-phosphate backbone elements (sugars, phosphates, and their bonds)
    console.log(`Processing ${elements.sugars1.length} sugars1, ${elements.sugars2.length} sugars2`);
    console.log(`Processing ${elements.phosphates1.length} phosphates1, ${elements.phosphates2.length} phosphates2`);
    
    elements.sugars1.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    elements.sugars2.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    elements.phosphates1.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    elements.phosphates2.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    
    // Adjust opacity of sugar and phosphate labels
    if (labels.visible) {
      labels.sugars1.forEach((label) => {
        setElementOpacity(label, opacity);
      });
      labels.sugars2.forEach((label) => {
        setElementOpacity(label, opacity);
      });
      labels.phosphates1.forEach((label) => {
        setElementOpacity(label, opacity);
      });
      labels.phosphates2.forEach((label) => {
        setElementOpacity(label, opacity);
      });
    }
    
    // Adjust opacity of phosphodiester bonds
    if (unwind.finished) {
      // Use dynamic bonds if unwound
      unwind.live.bondsPhospho1.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
      unwind.live.bondsPhospho1_3.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
      unwind.live.bondsPhospho2.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
      unwind.live.bondsPhospho2_3.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
    } else {
      // Use static bonds if not unwound
      elements.bondsSugarPhosphate.forEach((mesh) => {
        if (mesh) setElementOpacity(mesh, opacity);
      });
    }
  }

  function showRungsElements(show) {
    if (!dnaGroup) return;
    
    const opacity = show ? 1.0 : 0.3;
    
    // Adjust opacity of base elements and hydrogen bonds
    elements.bases1.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    elements.bases2.forEach(({ mesh }) => {
      setElementOpacity(mesh, opacity);
    });
    
    // Adjust opacity of base labels
    if (labels.visible) {
      labels.bases1.forEach((label) => {
        setElementOpacity(label, opacity);
      });
      labels.bases2.forEach((label) => {
        setElementOpacity(label, opacity);
      });
    }
    
    // Adjust opacity of hydrogen bonds between bases
    if (unwind.finished) {
      // Use dynamic bonds if unwound
      unwind.live.bondsHydrogen.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
    } else {
      // Use static bonds if not unwound
      elements.bondsHydrogen.forEach((mesh) => {
        if (mesh) setElementOpacity(mesh, opacity);
      });
    }
    
    // Adjust opacity of sugar-base bonds
    if (unwind.finished) {
      // Use dynamic bonds if unwound
      unwind.live.bondsSugarBase.forEach(({ mesh }) => {
        setElementOpacity(mesh, opacity);
      });
    } else {
      // Use static bonds if not unwound
      elements.bondsSugarBase.forEach((mesh) => {
        if (mesh) setElementOpacity(mesh, opacity);
      });
    }
  }

  function showAllElementsAtFullOpacity() {
    if (!dnaGroup) return;
    
    // Reset all elements to full opacity
    showRailsElements(true);
    showRungsElements(true);
  }


  function createButtonHTML(id, labelKey) {
    return `<br><button id="${id}" class="inst-btn" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3.5A3.5 3.5 0 1 0 12 15a3.5 3.5 0 0 0 0-7z"></path>
      </svg>
      ${t(labelKey)}
    </button>`;
  }

  function addButtonsToStep3Instruction(instructionElement) {
    // Replace placeholders with actual button HTML
    let content = instructionElement.innerHTML;
    
    const railsButtonHTML = createButtonHTML('btn-visualise-rails', 'visualiseRailsLabel');
    const rungsButtonHTML = createButtonHTML('btn-visualise-rungs', 'visualiseRungsLabel');
    
    content = content.replace('{VISUALISE_RAILS}', railsButtonHTML);
    content = content.replace('{VISUALISE_RUNGS}', rungsButtonHTML);
    
    instructionElement.innerHTML = content;
    
    // Add event listeners to the newly created buttons
    const railsButton = document.getElementById('btn-visualise-rails');
    const rungsButton = document.getElementById('btn-visualise-rungs');
    
    if (railsButton) {
      railsButton.addEventListener('click', toggleRailsVisualization);
    }
    if (rungsButton) {
      rungsButton.addEventListener('click', toggleRungsVisualization);
    }
  }

  function updateInstructions() {
    const el = document.getElementById('sim-instructions');
    if (state.step === 0) {
      el.innerHTML = t('dna_step0Instruction');
    } else if (state.step === 1) {
      el.innerHTML = t('dna_step1Instruction');
    } else if (state.step === 2) {
      el.innerHTML = t('dna_step2Instruction');
    } else if (state.step === 3) {
      el.innerHTML = t('dna_step3Instruction');
      addButtonsToStep3Instruction(el);
    } else if (state.step === 4) {
      el.innerHTML = t('dna_step4Instruction');
    } else if (state.step === 5) {
      el.innerHTML = t('dna_step5Instruction');
    } else if (state.step === 6) {
      el.innerHTML = t('dna_step6Instruction');
    }
  }

  function updateStateAndUI(){
    const nextBtn = document.getElementById('next-btn');
    if(state.step === 0){
      if(nextBtn){
        nextBtn.style.display = 'block';
        nextBtn.textContent = t('startButton');
      }
      if (!sceneInitialized) {
        initThree();
        buildDNAHelix();
        sceneInitialized = true;
        animate();
      }
    } else if(state.step === 1){
      if(nextBtn){
        nextBtn.textContent = t('unwindButton');
      }
      animateCameraZoom(2, 1000);
    } else if (state.step === 2) {
      startUnwindToPlane();
      if(nextBtn){
        nextBtn.textContent = t('zoomButton');
      }
    } else if(state.step === 3) {
      if(nextBtn){
        nextBtn.textContent = t('viewBondsButton');
      }
      animateCameraZoom(0.5, 1000);
      setTimeout(() => {
        showAllElementsAtFullOpacity();
      }, 100);
    } else if(state.step === 4){
      if(nextBtn){
        nextBtn.textContent = t('zoomButton');
      }
      showAllElementsAtFullOpacity();      
      startStructureExpansion();      
      animateCameraZoom(1.2, 1500);
    } else if(state.step === 5) {
      if(nextBtn){
        nextBtn.textContent = t('view3DButton');
      }
      const base1 = elements.bases1[13].mesh.position;
      const base2 = elements.bases2[13].mesh.position;
      const base3 = elements.bases1[14].mesh.position;
      const base4 = elements.bases2[14].mesh.position;
      const midPoint = new THREE.Vector3().addVectors(base1, base2).multiplyScalar(0.5);
      const midPoint2 = new THREE.Vector3().addVectors(base3, base4).multiplyScalar(0.5);
      const midPoint3 = new THREE.Vector3().addVectors(midPoint, midPoint2).multiplyScalar(0.5);
      animateCameraToLookAt(
        midPoint3,
        20,
        1500
      );
    } else if(state.step === 6){
      if(nextBtn){
        nextBtn.textContent = t('mainMenuButton');
      }      
      revertToOriginalHelix();      
      animateCameraToLookAt(
        new THREE.Vector3(0, 0, 100),
        100,
        2500
      );       
    }
    updateInstructions();
  }

  const homeBtn = document.getElementById('home-btn');
  homeBtn.onclick = () => {
    renderWelcomeScreen();
  };

  const nextBtn = document.getElementById('next-btn');
  nextBtn.onclick = () => {
    if (unwind.started && !unwind.finished) {
      return;
    }
    if(expansion.started && !expansion.finished){
      return;
    }
    if(state.step >= 6){
      renderNucliecAcidSelectionScreen();
    } else {
      state.step++;
      updateStateAndUI();      
    }
  };
  updateStateAndUI();
}