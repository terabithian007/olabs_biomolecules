

import { t } from './translations.js';
import cursorHandImg from '../images/cursor_hand.png';
import starImg from '../images/star.png';

import { renderDNASimulation } from './dna_simulation.js';
import { renderRNASimulation } from './rna_simulation.js';

export function renderNucliecAcidSelectionScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="sim-title">${t('title')}</div>
    <div class="sim-single-card-content">
      <div>
        <div class="sim-section-title-underline" style="margin-bottom: 2.2rem;"><img src="${starImg}" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;">${t('choose_your_nucleic_acid')}</div>
        <div style="margin-bottom: 1.5rem; font-size: 1.15rem;">${t('choose_your_nucleic_acid_description')}</div>
        <div class="all-btn-row">
          <button class="all-btn" style="cursor: url('${cursorHandImg}') 14 4, pointer;" id="dna-btn">DNA</button>
          <button class="all-btn" style="cursor: url('${cursorHandImg}') 14 4, pointer;" id="rna-btn">RNA</button>
        </div>        
      </div>
    </div>
  `;
  document.getElementById('dna-btn').onclick = () => {
    renderDNASimulation();
  };
  document.getElementById('rna-btn').onclick = () => {
    renderRNASimulation();
  };
}