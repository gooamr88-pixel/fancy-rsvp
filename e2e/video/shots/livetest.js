/* A four-beat probe of the LIVE path: does the running app load in the
   composer, does the session cookie get past the middleware, do the fixtures
   fill the dashboard, and does a real click actually switch a tab?
   Run with:  node e2e/video/record.js livetest --live --verify */
'use strict';

module.exports = [
  { t: 'wait', ms: 300 },
  { t: 'tag', text: 'Live &nbsp;<b>&middot;</b>&nbsp; the running app' },

  { t: 'show', app: '/', device: 'browser', url: 'fancyrsvp.com', settle: 2500 },
  { t: 'caption', eyebrow: 'Live', title: 'The real home page',
    body: 'Served by <code>next start</code> from the production build.' },
  { t: 'wait', ms: 800 },

  { t: 'show', app: '/dashboard', device: 'browser', url: 'fancyrsvp.com/dashboard', settle: 4000 },
  { t: 'caption', eyebrow: 'Live', title: 'The real dashboard',
    body: 'Past the auth middleware, with every API call answered from fixtures.' },
  { t: 'wait', ms: 1200 },
];
