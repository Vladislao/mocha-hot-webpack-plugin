const Mocha = require('mocha');
const path = require('path');
const vm = require('vm');
const util = require('util');

const wrapper = source => `(function (exports, require, module, __filename, __dirname){\nreturn ${source}\n})`;

const extractSources = (compiler, compilation, chunks) => {
  const sources = new Map();
  chunks.forEach((c) => {
    c.files.forEach((f) => {
      sources.set(path.join(compiler.outputPath, f), compilation.assets[f].source());
    });
  });
  return sources;
};

const createSeed = (compiler, compilation, seed) => {
  const chunks = compilation.chunks.filter(c => c.name === seed);
  if (chunks.length === 0) {
    throw new Error(`Chunk ${seed} was not found! Available chunks: ${util.inspect(compilation.chunks.map(c => c.name))}`);
  }

  const sources = Array.from(extractSources(compiler, compilation, chunks));
  const script = new vm.Script(wrapper(sources[0][1]), { filename: seed, displayErrors: true });
  const promise = script.runInThisContext()(exports, require, module, __filename, __dirname)();
  const result = promise instanceof Promise ? promise : new Promise(res => res(promise));

  return result;
};

Mocha.prototype.loadFiles = function loadFiles() {
  this.files.forEach((source) => {
    const script = new vm.Script(wrapper(source));
    this.suite.emit('pre-require', global, 'memory-fs', this);
    this.suite.emit('require', script.runInThisContext()(exports, require, module, __filename, __dirname), 'memory-fs', this);
    this.suite.emit('post-require', global, 'memory-fs', this);
  });
};

module.exports = class MochaHotPlugin {
  constructor(options = {}) {
    this.options = options;
    this.options.wait = options.wait === 0 ? 0 : options.wait || 600;

    this.chunkVersions = {};
    this.seed = options.seed ? false : new Promise(res => res());
    this.prev = null;
  }

  apply(compiler) {
    // compiler.outputFileSystem = new MemoryFileSystem();
    compiler.plugin('emit', (compilation, callback) => {
      if (!this.seed) {
        this.seed = createSeed(compiler, compilation, this.options.seed)
          .then(
            (seed) => {
              global[this.options.seed] = seed;
            },
            (err) => {
              console.error(err);
            },
          );
      }

      return this.seed.then(() => {
        const changedChunks = compilation.chunks.filter((chunk) => {
          if (chunk.name.indexOf('.test') === -1) return false;

          const oldVersion = this.chunkVersions[chunk.name];
          this.chunkVersions[chunk.name] = chunk.hash;
          return chunk.hash !== oldVersion;
        });

        if (changedChunks.length === 0) {
          return callback();
        }

        const sources = Array.from(extractSources(compiler, compilation, changedChunks));
        // console.log(changedChunks.map(c => c.name));

        if (sources.length === 0) {
          return callback();
        }

        if (this.prev) {
          clearTimeout(this.prev.timer);
          this.prev.callback();
        }

        this.prev = { callback };
        this.prev.timer = setTimeout(() => {
          this.prev = null;

          const mocha = new Mocha();
          if (this.options.seed) {
            mocha.globals(this.options.seed);
          }
          sources.forEach((s) => {
            mocha.addFile(s[1]);
          });
          return mocha.run(() => callback());
        }, this.options.wait);

        return this.timer;
      });
    });
  }
};

if (process.env.NODE_ENV === 'test') {
  module.exports.wrapper = wrapper;
  module.exports.extractSources = extractSources;
  module.exports.createSeed = createSeed;
  module.exports.loadFiles = Mocha.prototype.loadFiles;
}
