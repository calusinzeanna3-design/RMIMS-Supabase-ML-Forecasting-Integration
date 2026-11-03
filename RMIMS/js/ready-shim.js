/* RMIMS ready-shim
 * Pages import modules that use top-level await (the Supabase client). The browser fires
 * DOMContentLoaded / load WITHOUT waiting for those modules, so listeners registered by them
 * afterwards were never called and the whole page stayed empty ("stuck").
 * This tiny classic script makes late DOMContentLoaded / load listeners run right away.
 */
(function () {
  'use strict';
  var domReady = document.readyState !== 'loading' && document.readyState !== 'interactive' ? true : false;
  var loaded = document.readyState === 'complete';
  document.addEventListener('DOMContentLoaded', function () { domReady = true; }, true);
  window.addEventListener('load', function () { loaded = true; }, true);

  function patch(target, flagFn, type) {
    var orig = target.addEventListener;
    target.addEventListener = function (t, fn, opts) {
      if (t === type && typeof fn !== 'undefined' && fn && flagFn()) {
        var self = this;
        setTimeout(function () {
          try {
            var ev = new Event(type);
            if (typeof fn === 'function') fn.call(self, ev); else if (fn.handleEvent) fn.handleEvent(ev);
          } catch (e) { console.error(e); }
        }, 0);
        return;
      }
      return orig.call(this, t, fn, opts);
    };
  }
  patch(document, function () { return domReady; }, 'DOMContentLoaded');
  patch(window, function () { return loaded; }, 'load');
})();
