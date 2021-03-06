/**
 * Copyright 2020 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const argv = require('minimist')(process.argv.slice(2));
const conf = require('./build.conf');
const crypto = require('crypto');
const globby = require('globby');
const gulpBabel = require('gulp-babel');
const through = require('through2');
const {BABEL_SRC_GLOBS, THIRD_PARTY_TRANSFORM_GLOBS} = require('./sources');

/**
 * Files on which to run pre-closure babel transforms.
 *
 * @private @const {!Array<string>}
 */
const filesToTransform = getFilesToTransform();

/**
 * Used to cache babel transforms.
 *
 * @private @const {!Object<string, string>}
 */
const cache = Object.create(null);

/**
 * Computes the set of files on which to run pre-closure babel transforms.
 *
 * @return {!Array<string>}
 */
function getFilesToTransform() {
  return globby
    .sync([...BABEL_SRC_GLOBS, '!node_modules/', '!third_party/'])
    .concat(globby.sync(THIRD_PARTY_TRANSFORM_GLOBS));
}

/**
 * @param {!Buffer} contents
 * @return {string}
 */
function sha256(contents) {
  const hash = crypto.createHash('sha256');
  hash.update(contents);
  return hash.digest('hex');
}

/**
 * Apply babel transforms prior to closure compiler pass.
 *
 * When a source file is transformed for the first time, it is written to an
 * in-memory cache from where it is retrieved every subsequent time without
 * invoking babel.
 *
 * @return {!Promise}
 */
function preClosureBabel() {
  const babelPlugins = conf.plugins({
    isForTesting: !!argv.fortesting,
    isEsmBuild: !!argv.esm,
    isSinglePass: !!argv.single_pass,
    isChecktypes: argv._.includes('check-types'),
  });
  const babel = gulpBabel({
    plugins: babelPlugins,
    retainLines: true,
    compact: false,
  });

  return through.obj((file, enc, next) => {
    const {relative, path} = file;
    if (!filesToTransform.includes(relative)) {
      return next(null, file);
    }

    const hash = sha256(file.contents);
    const cached = cache[path];
    if (cached && cached.hash === hash) {
      return next(null, cached.file.clone());
    }

    let data, err;
    function onData(d) {
      babel.off('error', onError);
      data = d;
    }
    function onError(e) {
      babel.off('data', onData);
      err = e;
    }
    babel.once('data', onData);
    babel.once('error', onError);
    babel.write(file, enc, () => {
      if (err) {
        return next(err);
      }

      cache[path] = {
        file: data,
        hash,
      };
      next(null, data.clone());
    });
  });
}

module.exports = {
  preClosureBabel,
};
