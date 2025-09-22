import { renderNucliecAcidSelectionScreen } from './nucleic_acid_selection.js';
import { t } from './translations.js';

import cursorHandImg from '../images/cursor_hand.png';
import starImg from '../images/star.png';

export function renderWelcomeScreen() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="sim-title">${t('title')}</div>
      <div class="sim-single-card-content">
        <div>
          <div class="sim-section-title-underline"><img src="${starImg}" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;">${t('objective')}</div>          
          <div style="margin-bottom: 1.5rem; font-size: 1.15rem;">${t('objectiveDescription')}</div>
          <div class="sim-section-title-underline"><img src="${starImg}" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;">${t('whatYouWillLearn')}</div>
          <ul class="sim-list">
            <li>${t('learnItem1')}</li>
            <li>${t('learnItem2')}</li>
            <li>${t('learnItem3')}</li>
          </ul>
          <button class="sim-btn" style="cursor: url('${cursorHandImg}') 14 4, pointer;" id="start-btn">${t('startButton')}</button>
        </div>
      </div>
    `;
    document.getElementById('start-btn').onclick = () => {
      renderNucliecAcidSelectionScreen();      
    };
  }