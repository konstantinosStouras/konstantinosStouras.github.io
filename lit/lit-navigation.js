/* Native details works without JavaScript; add dismissal and legacy news links. */
(function () {
  'use strict';
  var menu = document.querySelector('.lit-site-nav details');
  if (menu) {
    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }
  if (/\/lit\/about\/?$/.test(location.pathname) &&
      /^#(?:litWhatsNewHead|litWhatsNew|whats-new)$/.test(location.hash)) {
    location.replace('/lit/whats-new/');
  }
})();

/* One copyright strip for the browser and all public resource pages. */
(function () {
  'use strict';
  var host = document.querySelector('.lit-privacy-footer');
  if (!host) {
    var privacy = document.querySelector('.footer .lit-footer-privacy');
    if (privacy) host = privacy.parentElement;
  }
  if (!host) return;
  var strip = document.createElement(host.tagName === 'FOOTER' ? 'footer' : 'div');
  strip.className = 'lit-site-footer';
  var copyright = document.createElement('span');
  copyright.className = 'lit-copyright';
  copyright.appendChild(document.createTextNode('© 2014–' + new Date().getFullYear() + ' '));
  var owner = document.createElement('a');
  owner.href = 'https://www.stouras.com/';
  owner.textContent = 'Konstantinos I. Stouras';
  copyright.appendChild(owner);
  var links = document.createElement('nav');
  links.className = 'lit-footer-links';
  links.setAttribute('aria-label', 'Footer');
  [['About', '/lit/about/'], ['Privacy', '/lit/privacy/']].forEach(function (item) {
    var link = document.createElement('a');
    link.href = item[1];
    link.textContent = item[0];
    links.appendChild(link);
  });
  strip.appendChild(copyright);
  strip.appendChild(links);
  host.replaceWith(strip);
})();
