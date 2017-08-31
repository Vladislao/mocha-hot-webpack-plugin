const chai = require('chai');
const spies = require('chai-spies');
const path = require('path');
const Mocha = require('mocha');
const MochaHotPlugin = require('../MochaHotPlugin');

const expect = chai.expect;
chai.use(spies);

const { wrapper, extractSources, createSeed, loadFiles } = MochaHotPlugin;

describe('.wrapper', () => {
  it('should wrap code correctly', () => {
    expect(wrapper('1')).to.be.eql('(function (exports, require, module, __filename, __dirname){\nreturn 1\n})');
  });
});

describe('.extractSources', () => {
  const compilation = () => ({
    assets: {
      a: { source: () => 1 },
      b: { source: () => 2 },
      c: { source: () => 3 },
    }
  });

  it('should return Map with path as key and source code as value', () => {
    const sources = extractSources(
      { outputPath: 'dist/' },
      compilation(),
      [{ files: ['a'] }, { files: ['b'] }, { files: ['c'] }]
    );

    expect(sources).to.be.a('map');
    expect(Array.from(sources.keys())).to.include(path.normalize('dist/b'));
    expect(Array.from(sources.values())).to.include(2);
  });

  it('should merge save files', () => {
    const sources = extractSources(
      { outputPath: 'dist/' },
      compilation(),
      [{ files: ['a'] }, { files: ['a', 'b'] }, { files: ['b', 'c'] }]
    );

    expect(Array.from(sources.keys()).length).to.be.eql(3);
  });
});

describe('.createSeed', () => {
  it('should return promise', () => {
    const seed = createSeed(
      { outputPath: 'dist/' },
      {
        chunks: [{ name: 'a', files: ['a'] }, { name: 'b', files: ['b'] }],
        assets: { a: { source: () => '() => new Promise(res => res());' }, b: { source: () => 'false' } }
      },
      'a'
    );

    expect(seed).to.be.a('promise');
  });

  it('should throw when chunk is not found', () => {
    const fn = createSeed.bind(
      null,
      { outputPath: 'dist/' },
      {
        chunks: [{ name: 'b', files: ['b'] }],
        assets: { b: { source: () => 'false' } }
      },
      'a'
    );

    expect(fn).to.throw(Error);
  });

  it('should wrap result in Promise when required', () => {
    const seed = createSeed(
      { outputPath: 'dist/' },
      {
        chunks: [{ name: 'a', files: ['a'] }, { name: 'b', files: ['b'] }],
        assets: { a: { source: () => '() => true' }, b: { source: () => 'false' } }
      },
      'a'
    );

    expect(seed).to.be.a('promise');
  });
});

describe('.loadFiles', () => {
  it('should wrap and execute scripts', () => {
    const emitter = chai.spy();
    const ctx = {
      files: ['1', '2', '3'],
      suite: {
        emit: emitter
      }
    };

    loadFiles.call(ctx);
    expect(emitter).to.have.been.called.above(3);
  });
  it('should not throw on empty list', () => {
    loadFiles.call({
      files: []
    });
  });
});

describe('MochaHotPlugin', () => {
  const compilation = () => ({
    assets: {
      a: { source: () => 1 },
      b: { source: () => 2 }
    },
    chunks: [
      {
        name: 'a.test',
        hash: '1',
        files: ['a']
      },
      {
        name: 'b.test',
        hash: '1',
        files: ['b']
      }
    ]
  });

  before(() => {
    Mocha.prototype.run = chai.spy(cb => cb());
  });

  beforeEach(() => {
    Mocha.prototype.run.reset();
  });

  it('should have apply method', () => {
    const plugin = new MochaHotPlugin({ wait: 0 });
    expect(plugin).to.have.property('apply').that.a('function');
  });

  it('should run when compiled for the first time', async () => {
    const plugin = new MochaHotPlugin({ wait: 0 });

    await new Promise((res) => {
      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(compilation(), res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.once;
  });

  it('should run when chunks are changed', async () => {
    const plugin = new MochaHotPlugin({ wait: 0 });

    await new Promise((res) => {
      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(compilation(), res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.once;

    await new Promise((res) => {
      const c = compilation();
      c.chunks[0].hash = '2';

      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(c, res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.twice;
  });

  it('should not run when chunks are not changed', async () => {
    const plugin = new MochaHotPlugin({ wait: 0 });

    await new Promise((res) => {
      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(compilation(), res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.once;

    await new Promise((res) => {
      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(compilation(), res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.once;
  });

  it('should wait and not run twice', async () => {
    const plugin = new MochaHotPlugin({ wait: 100 });

    const run1 = new Promise((res) => {
      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(compilation(), res);
        }
      });
    });

    const run2 = new Promise((res) => {
      const c = compilation();
      c.chunks[0].hash = '2';

      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(c, res);
        }
      });
    });

    await Promise.all([run1, run2]);

    expect(Mocha.prototype.run).to.have.been.called.once;
  });

  it('should await for seed', async () => {
    const plugin = new MochaHotPlugin({ wait: 0, seed: 'b.test' });

    await new Promise((res) => {
      const c = compilation();
      c.assets.b.source = () => '() => true';

      plugin.apply({
        outputPath: 'dist',
        plugin: (type, fn) => {
          fn(c, res);
        }
      });
    });

    expect(Mocha.prototype.run).to.have.been.called.once;
  });
});
