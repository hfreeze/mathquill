// This script assumes the following:
//   1. You've installed wd with `npm install wd'.
//   2. You've set the environment variables $SAUCE_USERNAME and $SAUCE_ACCESS_KEY.
//   3. If the environment variable $CIRCLE_ARTIFACTS is not set images will be saved in /tmp
//
// This scripts creates following files for each browser in browserVersions:
//    $CIRCLE_ARTIFACTS/imgs/{browser_version_platform}/#.png
//
// The intention of this script is that it will be ran from CircleCI
//
// Example usage:
//   node screenshots.js http://localhost:9292/test/visual.html
//   node screenshots.js http://google.com

var wd = require('wd');
var fs = require('fs');
var url = process.argv[2];
var username = process.env.SAUCE_USERNAME;
var accessKey = process.env.SAUCE_ACCESS_KEY;
var build_name = process.env.MQ_CI_BUILD_NAME;
var baseDir = process.env.CIRCLE_ARTIFACTS;
if (!baseDir) {
  console.error('No $CIRCLE_ARTIFACTS found, for testing do something like `CIRCLE_ARTIFACTS=/tmp script/screenshots.js`');
  process.exit(1);
}
fs.mkdirSync(baseDir+'/imgs');

var browsers = [
  {
    config: {
      browserName: 'Internet Explorer',
      platform: 'Windows XP'
    },
    pinned: true // should be pinned to IE 8
  },
  {
    config: {
      // Expecting IE 11
      browserName: 'Internet Explorer',
      platform: 'Windows 7'
    },
    pinned: true // should be pinned to IE 11
  },
  {
    config: {
      browserName: 'MicrosoftEdge',
      platform: 'Windows 10'
    }
  },
  {
    config: {
      browserName: 'Firefox',
      platform: 'OS X 10.11'
    }
  },
  {
    config: {
      browserName: 'Safari',
      platform: 'OS X 10.11'
    }
  },
  {
    config: {
      browserName: 'Chrome',
      platform: 'OS X 10.11'
    }
  },
  {
    config: {
      browserName: 'Firefox',
      platform: 'Linux'
    }
  }
];


browsers.forEach(function(browser) {
  browser.config.build = build_name;
  var browserDriver = wd.promiseChainRemote('ondemand.saucelabs.com', 80, username, accessKey);
  return browserDriver.init(browser.config)
  .then(function(sessionID, capabilities) {
    var cfg = capabilities || browser.config;
    console.log(cfg.browserName, cfg.version, cfg.platform, 'init', sessionID);

    var pinned = browser.pinned ? 'PINNED' : 'EVERGREEN';
    var filename = [pinned, cfg.platform, cfg.browserName].join('_').replace(/ /g, '_');

    return browserDriver.get(url)
    .then(function() {
      console.log(cfg.browserName, cfg.version, cfg.platform, 'get');
      return [browserDriver.safeExecute('document.documentElement.scrollHeight'),
              browserDriver.safeExecute('document.documentElement.clientHeight')];
    })
    .spread(function(scrollHeight, viewportHeight) {
      console.log(cfg.browserName, cfg.version,  cfg.platform, 'get scrollHeight, clientHeight', scrollHeight, viewportHeight);

      // the easy case: Firefox and IE return a screenshot of the entire webpage
      if (cfg.browserName === 'Firefox' || cfg.browserName === 'Internet Explorer') {
        return browserDriver.saveScreenshot(baseDir + '/imgs/' + filename + '.png')
        .then(willLog(cfg.browserName, cfg.version, cfg.platform, 'saveScreenshot'))
      // the hard case: for Chrome, Safari, and Edge, scroll through the page and
      // take screenshots of each piece; circle.yml will stitch them together
      } else {
        var piecesDir = baseDir + '/imgs/' + filename + '/';
        fs.mkdirSync(piecesDir);

        var scrollTop = 0;
        var index = 1;
        return (function loop() {
          return browserDriver.saveScreenshot(piecesDir + index + '.png')
          .then(function() {
            console.log(cfg.browserName, cfg.version, cfg.platform, 'saveScreenshot');

            scrollTop += viewportHeight;
            index += 1;

            // if the viewport hasn't passed the bottom edge of the page yet,
            // scroll down and take another screenshot
            if (scrollTop + viewportHeight <= scrollHeight) {
              // Use `window.scrollTo` because thats what jQuery does:
              //   https://github.com/jquery/jquery/blob/1.12.3/src/offset.js#L186
              // Use `window.scrollTo` instead of jQuery because jQuery was
              // causing a stackoverflow in Safari.
              return browserDriver.safeEval('window.scrollTo(0,'+scrollTop+');')
              .then(willLog(cfg.browserName, cfg.version, cfg.platform, 'scrollTo()'))
              .then(loop);
            } else { // we are past the bottom edge of the page, reduce window size to
              // fit only the part of the page that hasn't been screenshotted.

              // If there is no remaining part of the page, we're done, short-circuit
              if (scrollTop === scrollHeight) return browserDriver;

              return browserDriver.getWindowSize()
              .then(function(windowSize) {
                console.log(cfg.browserName, cfg.version, cfg.platform, 'getWindowSize');
                // window size is a little bigger than the viewport because of address
                // bar and scrollbars and stuff
                var windowPadding = windowSize.height - viewportHeight;
                var newWindowHeight = scrollHeight - scrollTop + windowPadding;
                return browserDriver.setWindowSize(windowSize.width, newWindowHeight)
                .then(willLog(cfg.browserName, cfg.version, cfg.platform, 'setWindowSize'))
                .safeEval('window.scrollTo(0,'+scrollHeight+');')
                .then(willLog(cfg.browserName, cfg.version, cfg.platform, 'scrollTo() Final'))
                .saveScreenshot(piecesDir + index + '.png')
                .then(willLog(cfg.browserName, cfg.version, cfg.platform, 'saveScreenshot Final'));
              });
            }
          });
        })();
      }
    })
    .log('browser')
    .then(function(logs) {
      var logfile = baseDir + '/' + [cfg.browserName, cfg.version, cfg.platform].join('_').replace(/ /g, '_');
      return new Promise(function(resolve, reject) {
        fs.writeFile(logfile, logs.join('\n'), function(err) {
          if (err) return reject(err);
          console.log(cfg.browserName, cfg.version, cfg.platform, 'writeFile');

          return resolve(browserDriver.quit());
        });
      });
    }, function(err) {
      // the Edge/Internet Explorer drivers don't support logs, but the others do
      console.log(cfg.browserName, cfg.platform, 'Error fetching logs:', JSON.stringify(err, null, 2));
      return [];
    });
  })
  .fail(function(err) {
    console.log('ERROR:', cfg.browserName, cfg.platform);
    console.log(JSON.stringify(err, null, 2));
  });

  function willLog() {
    var msg = [].join.call(arguments, ' ');
    return function(value) {
      console.log(msg);
      return value;
    };
  }
});
