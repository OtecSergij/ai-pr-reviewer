import { createHash } from "node:crypto";

import {
  GitHubApiError,
  NotFoundError,
  type DirectoryEntry,
  type GithubAccess,
  type PRFileSummary,
  type PRMetadata,
} from "@/lib/github/octokit";
import type { PRRef } from "@/lib/github/parse-url";
import { basename } from "@/lib/path";

const HEAD_SHA = "7c2d4f1b0e9a3c85d6f2b1a4e8c0d9f3a6b5c4e2";

const INDEX_JS = `/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var w = d * 7;
var y = d * 365.25;

/**
 * Parse or format the given \`val\`.
 *
 * Options:
 *
 *  - \`long\` verbose formatting [false]
 *
 * Examples:
 *
 *   ms('2 days')  // 172800000
 *   ms('1h')      // 3600000
 *   ms('10s')     // 10000
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

module.exports = function (val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isFinite(val)) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given \`str\` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^(-?(?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'weeks':
    case 'week':
    case 'w':
      return n * w;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for \`ms\`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= y) {
    return Math.round(ms / y) + 'y';
  }
  if (msAbs >= w) {
    return Math.round(ms / w) + 'w';
  }
  if (msAbs >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (msAbs >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (msAbs >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (msAbs >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for \`ms\`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= y) {
    return plural(ms, msAbs, y, 'year');
  }
  if (msAbs >= w) {
    return plural(ms, msAbs, w, 'week');
  }
  if (msAbs >= d) {
    return plural(ms, msAbs, d, 'day');
  }
  if (msAbs >= h) {
    return plural(ms, msAbs, h, 'hour');
  }
  if (msAbs >= m) {
    return plural(ms, msAbs, m, 'minute');
  }
  if (msAbs >= s) {
    return plural(ms, msAbs, s, 'second');
  }
  return ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, msAbs, n, name) {
  var isPlural = msAbs >= n * 1.5;
  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
}
`;

const TEST_JS = `/* global describe, it */

var expect = require('expect.js');
var ms = require('../');

// strings

describe('ms(string)', function () {
  it('should not throw an error', function () {
    expect(function () {
      ms('1m');
    }).to.not.throwError();
  });

  it('should preserve ms', function () {
    expect(ms('100')).to.be(100);
  });

  it('should convert from m to ms', function () {
    expect(ms('1m')).to.be(60000);
  });

  it('should convert from h to ms', function () {
    expect(ms('1h')).to.be(3600000);
  });

  it('should convert d to ms', function () {
    expect(ms('2d')).to.be(172800000);
  });

  it('should convert s to ms', function () {
    expect(ms('1s')).to.be(1000);
  });

  it('should convert ms to ms', function () {
    expect(ms('100ms')).to.be(100);
  });

  it('should work with decimals', function () {
    expect(ms('1.5h')).to.be(5400000);
  });

  it('should work with multiple spaces', function () {
    expect(ms('1   s')).to.be(1000);
  });

  it('should return NaN if invalid', function () {
    expect(isNaN(ms('☃'))).to.be(true);
    expect(isNaN(ms('10-.5'))).to.be(true);
  });

  it('should be case-insensitive', function () {
    expect(ms('1.5H')).to.be(5400000);
  });

  it('should convert w to ms', function () {
    expect(ms('3w')).to.be(1814400000);
  });
});

describe('ms(long string)', function () {
  it('should convert weeks to ms', function () {
    expect(ms('2 weeks')).to.be(1209600000);
  });

  it('should not throw an error', function () {
    expect(function () {
      ms('53 milliseconds');
    }).to.not.throwError();
  });

  it('should convert milliseconds to ms', function () {
    expect(ms('53 milliseconds')).to.be(53);
  });

  it('should convert msecs to ms', function () {
    expect(ms('17 msecs')).to.be(17);
  });

  it('should convert sec to ms', function () {
    expect(ms('1 sec')).to.be(1000);
  });

  it('should convert from min to ms', function () {
    expect(ms('1 min')).to.be(60000);
  });

  it('should convert from hr to ms', function () {
    expect(ms('1 hr')).to.be(3600000);
  });

  it('should convert days to ms', function () {
    expect(ms('2 days')).to.be(172800000);
  });
});

describe('ms(number, { long: true })', function () {
  it('should support weeks', function () {
    expect(ms(1209600000, { long: true })).to.be('2 weeks');
  });

  it('should support days', function () {
    expect(ms(86400000, { long: true })).to.be('1 day');
  });

  it('should support hours', function () {
    expect(ms(3600000, { long: true })).to.be('1 hour');
  });
});
`;

const README_MD = `# ms

Supported units and the aliases the parser accepts, weeks included since 2.2.0:

| unit | aliases |
| ---- | ------- |
| milliseconds | \`ms\`, \`msec\`, \`msecs\`, \`millisecond\`, \`milliseconds\` |
| seconds | \`s\`, \`sec\`, \`secs\`, \`second\`, \`seconds\` |
| minutes | \`m\`, \`min\`, \`mins\`, \`minute\`, \`minutes\` |
| hours | \`h\`, \`hr\`, \`hrs\`, \`hour\`, \`hours\` |
| days | \`d\`, \`day\`, \`days\` |
| years | \`y\`, \`yr\`, \`yrs\`, \`year\`, \`years\` |

## Examples

\`\`\`js
ms('2 days'); // 172800000
ms('1d'); // 86400000
ms('10h'); // 36000000
ms('2.5 hrs'); // 9000000
ms('2 weeks'); // 1209600000
ms('100'); // 100
ms('-3 days'); // -259200000
\`\`\`

### Convert from milliseconds

\`\`\`js
ms(60000); // "1m"
ms(2 * 60000); // "2m"
ms(-3 * 60000); // "-3m"
ms(ms('10 hours')); // "10h"
\`\`\`

### Time format written-out

\`\`\`js
ms(60000, { long: true }); // "1 minute"
ms(2 * 60000, { long: true }); // "2 minutes"
ms(ms('10 hours'), { long: true }); // "10 hours"
\`\`\`

## Features

- Works both in Node.js and in the browser
- If a number is supplied to \`ms\`, a string with a unit is returned
- If a string that contains the number is supplied, it returns it as a number
- If you pass a string with a number and a valid unit, the number of equivalent milliseconds is returned

## Related Packages

- [ms.macro](https://github.com/knpwrs/ms.macro) - Run \`ms\` as a macro at build-time.

## Caught a Bug?

1. Fork this repository to your own GitHub account and then clone it to your local device
2. Link the package to the global module directory: \`npm link\`
3. Within the module you want to test your local development instance of ms, just link it to the dependencies: \`npm link ms\`
`;

const PACKAGE_JSON = `{
  "name": "ms",
  "version": "2.2.0",
  "description": "Tiny millisecond conversion utility",
  "repository": "vercel/ms",
  "main": "./index",
  "files": [
    "index.js"
  ],
  "scripts": {
    "lint": "eslint index.js test/test.js",
    "test": "mocha test/test.js"
  },
  "license": "MIT",
  "devDependencies": {
    "eslint": "8.57.0",
    "expect.js": "0.3.1",
    "mocha": "10.4.0"
  }
}
`;

const LICENSE_MD = `# License (MIT)

Copyright (c) 2024 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
`;

const PR_METADATA: PRMetadata = {
  title: "parse: support week units (w, week, weeks)",
  body: `Adds \`w\` / \`week\` / \`weeks\` to the parser, alongside the unit aliases that are
already supported.

- \`parse\` learns the new aliases and multiplies by \`w = d * 7\`
- \`fmtShort\` and \`fmtLong\` render weeks between years and days
- tests cover the short form, the long form and the written-out format

The unit table in the README is left as it is; documenting the new alias is
follow-up work.
`,
  isPrivate: false,
  baseRef: "master",
  headRef: "add-week-unit",
  headSha: HEAD_SHA,
  changedFiles: 3,
};

const CHANGED_FILES: PRFileSummary[] = [
  {
    filename: "index.js",
    status: "modified",
    additions: 12,
    deletions: 1,
    changes: 13,
    previousFilename: null,
  },
  {
    filename: "test/test.js",
    status: "modified",
    additions: 12,
    deletions: 0,
    changes: 12,
    previousFilename: null,
  },
  {
    filename: "README.md",
    status: "modified",
    additions: 2,
    deletions: 1,
    changes: 3,
    previousFilename: null,
  },
];

const PATCHES = new Map<string, string>([
  [
    "index.js",
    `@@ -6,6 +6,7 @@ var s = 1000;
 var m = s * 60;
 var h = m * 60;
 var d = h * 24;
+var w = d * 7;
 var y = d * 365.25;
 
 /**
@@ -55,7 +56,7 @@ function parse(str) {
   if (str.length > 100) {
     return;
   }
-  var match = /^(-?(?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
+  var match = /^(-?(?:\\d+)?\\.?\\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
     str
   );
   if (!match) {
@@ -70,6 +71,10 @@ function parse(str) {
     case 'yr':
     case 'y':
       return n * y;
+    case 'weeks':
+    case 'week':
+    case 'w':
+      return n * w;
     case 'days':
     case 'day':
     case 'd':
@@ -116,6 +121,9 @@ function fmtShort(ms) {
   if (msAbs >= y) {
     return Math.round(ms / y) + 'y';
   }
+  if (msAbs >= w) {
+    return Math.round(ms / w) + 'w';
+  }
   if (msAbs >= d) {
     return Math.round(ms / d) + 'd';
   }
@@ -144,6 +152,9 @@ function fmtLong(ms) {
   if (msAbs >= y) {
     return plural(ms, msAbs, y, 'year');
   }
+  if (msAbs >= w) {
+    return plural(ms, msAbs, w, 'week');
+  }
   if (msAbs >= d) {
     return plural(ms, msAbs, d, 'day');
   }
`,
  ],
  [
    "test/test.js",
    `@@ -52,9 +52,17 @@ describe('ms(string)', function () {
   it('should be case-insensitive', function () {
     expect(ms('1.5H')).to.be(5400000);
   });
+
+  it('should convert w to ms', function () {
+    expect(ms('3w')).to.be(1814400000);
+  });
 });
 
 describe('ms(long string)', function () {
+  it('should convert weeks to ms', function () {
+    expect(ms('2 weeks')).to.be(1209600000);
+  });
+
   it('should not throw an error', function () {
     expect(function () {
       ms('53 milliseconds');
@@ -87,6 +95,10 @@ describe('ms(long string)', function () {
 });
 
 describe('ms(number, { long: true })', function () {
+  it('should support weeks', function () {
+    expect(ms(1209600000, { long: true })).to.be('2 weeks');
+  });
+
   it('should support days', function () {
     expect(ms(86400000, { long: true })).to.be('1 day');
   });
`,
  ],
  [
    "README.md",
    `@@ -1,6 +1,6 @@
 # ms
 
-Supported units and the aliases the parser accepts:
+Supported units and the aliases the parser accepts, weeks included since 2.2.0:
 
 | unit | aliases |
 | ---- | ------- |
@@ -18,6 +18,7 @@ ms('2 days'); // 172800000
 ms('1d'); // 86400000
 ms('10h'); // 36000000
 ms('2.5 hrs'); // 9000000
+ms('2 weeks'); // 1209600000
 ms('100'); // 100
 ms('-3 days'); // -259200000
 \`\`\`
`,
  ],
]);

const FILE_CONTENTS = new Map<string, string>([
  ["index.js", INDEX_JS],
  ["test/test.js", TEST_JS],
  ["README.md", README_MD],
  ["package.json", PACKAGE_JSON],
  ["license.md", LICENSE_MD],
]);

const DIRECTORIES = new Map<string, string[]>([
  ["", ["README.md", "index.js", "license.md", "package.json", "test"]],
  ["test", ["test/test.js"]],
]);

export function createFixtureGithubAccess(pr: PRRef): GithubAccess {
  return {
    getPRMetadata: async () => PR_METADATA,
    getPRFiles: async () => CHANGED_FILES,
    getFile: async (filename) =>
      CHANGED_FILES.find((f) => f.filename === filename) ?? null,
    getDiff: async (filename) => PATCHES.get(filename) ?? null,
    getFileContents: async ({ path, ref, maxBytes }) => {
      if (DIRECTORIES.has(path)) {
        throw new GitHubApiError(
          200,
          `Expected file at ${path}, got directory`,
        );
      }

      const content = FILE_CONTENTS.get(path);

      if (content === undefined) {
        throw new NotFoundError(`file ${pr.owner}/${pr.repo}@${ref}:${path}`);
      }

      const size = byteSize(content);

      return {
        path,
        ref,
        content: size > maxBytes ? null : content,
        size,
        sha: blobSha(content),
      };
    },
    listDirectory: async ({ path, ref }) => {
      const entries = DIRECTORIES.get(path);

      if (!entries) {
        if (FILE_CONTENTS.has(path)) {
          throw new GitHubApiError(
            200,
            `Expected directory at ${path}, got file`,
          );
        }

        throw new NotFoundError(
          `directory ${pr.owner}/${pr.repo}@${ref}:${path || "/"}`,
        );
      }

      return entries.map(toDirectoryEntry);
    },
  };
}

function toDirectoryEntry(path: string): DirectoryEntry {
  const content = FILE_CONTENTS.get(path);

  if (content === undefined) {
    return {
      path,
      name: basename(path),
      type: "dir",
      size: 0,
      sha: shaOf(`tree ${path}`),
    };
  }

  return {
    path,
    name: basename(path),
    type: "file",
    size: byteSize(content),
    sha: blobSha(content),
  };
}

function byteSize(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function blobSha(content: string): string {
  return shaOf(`blob ${byteSize(content)}\0${content}`);
}

function shaOf(seed: string): string {
  return createHash("sha1").update(seed).digest("hex");
}
