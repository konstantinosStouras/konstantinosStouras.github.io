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
