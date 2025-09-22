import { renderWelcomeScreen } from './welcome.js';
import { defaultLanguage } from './translations.js';

function updateLanguage(language) {  
  document.body.setAttribute('data-language', language);
}
updateLanguage(defaultLanguage);

renderWelcomeScreen();