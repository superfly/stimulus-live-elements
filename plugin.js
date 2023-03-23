"use strict";

// resulting object only has a 'keys' property and default module definitions
//  * has no 'resolve' function
//  * has no 'id' property
//  * module definitions does not contain named exports
//  * fourth argument to require.context (sync) is ignored/not supported

const acorn = require("acorn");
const stage3 = require("acorn-stage3");
const walk = require("acorn-walk");
const astring = require("astring");
const path = require('path');
const fsp = require('fs').promises;

let dirWatchers = {};

let parser = acorn.Parser.extend(stage3);

// Replace call to require.context with an object literal, prepending import
// import statements as required.  If no require.context calls are found,
// null will be returned, allowing the code to pass on to the next plugin.
// See: https://www.snowpack.dev/guides/plugins#tips-%2F-gotchas
async function require_context(filePath) {
  let source = await fsp.readFile(filePath, 'utf8');

  // If there are no occurences of "require.context(", remove source from
  // dirWatchers and return null
  if (!/\brequire\s*\.\s*context\s*\(/.test(source)) {
    delete dirWatchers[filePath];
    return null;
  }

  let ast = parser.parse(source,
    { sourceType: 'module', ecmaVersion: 'latest', locations: true });

  // determine base directory
  let base = path.dirname(path.resolve(filePath));

  // find all context.require calls in this AST
  let nodes = [];
  walk.simple(ast, {
    CallExpression(node) {
      // match context.require(Literal...) calls
      let { callee } = node;
      let args = node.arguments; // curse you, strict mode!
      if (callee.type !== 'MemberExpression') return;
      if (callee.object.name !== 'require') return;
      if (callee.property.name !== 'context') return;
      if (args.length === 0) return;
      if (!args.every(arg => arg.type === 'Literal')) return;
      if (args.length > 2 && !args[2].regex) return;
      nodes.push(node);
    }
  });

  // If none found, remove source from dirWatchers and return null
  if (nodes.length === 0) {
    delete dirWatchers[filePath];
    return null;
  }

  let imports = []; // list of imports to be prepended
  let dirs = []; // list of directories to be watched for changes

  await Promise.all(nodes.map(async node => {
    // extract arguments
    let args = node.arguments;
    let directory = path.resolve(base, args[0].value);
    let recurse = args[1] && args[1].value;
    let regExp = args[2] && new RegExp(args[2].regex.pattern, args[2].regex.flags);

    // add directory to the list to be watched for changes
    dirs.push(directory);

    // get a list of files in a given directory matching a given pattern,
    // optionally recursively.
    async function getFiles(dir, recurse, pattern) {
      try {
        const dirents = await fsp.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map(dirent => {
          const res = path.resolve(dir, dirent.name);

          if (dirent.isDirectory()) {
            return (recurse !== false) && getFiles(res, recurse, pattern);
          } else {
            return (!pattern || pattern.test(res)) ? res : null
          }
        }));

        return Array.prototype.concat(...files);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      };
    }

    // get a list of files, remove nulls, make file names relative to base
    let files = (await getFiles(directory, recurse, regExp)).
      filter(file => file).map(file => {
        file = path.relative(base, file);
        if (!file.startsWith('/') && !file.startsWith('.')) file = `./${file}`;
        return file
      });

    // keys are relative to the directory, not the base
    let keys = files.map(file =>
      path.relative(directory, path.resolve(base, file)));

    // compute module name from keys converting from dashes to snakecase.
    let modules = keys.map(key => {
      // remove extension
      let parts = key.split('/');
      parts.push(parts.pop().split('.')[0]);

      // convert to snakecase, replacing '/' with '_'
      return parts.map(part => part.
        replace(/^\w/, c => c.toUpperCase()).
        replace(/[-_]\w/g, c => c[1].toUpperCase()).replace(/\W/g, '$'))
        .join('_');
    });

    // add an import for each module to the list of prepends
    files.forEach((file, i) => {
      imports.push({
        type: "ImportDeclaration",
        specifiers: [
          {
            type: "ImportDefaultSpecifier",
            local: { type: "Identifier", name: modules[i] }
          }
        ],
        source: { type: "Literal", value: file, raw: JSON.stringify(file) }
      })
    });

    // build a list of files
    let contextKeys = {
      type: "ArrayExpression",
      elements: keys.map(file => (
        { type: "Literal", value: file, raw: JSON.stringify(file) }
      ))
    };

    // build a map of files to {default: modules} object literals
    let contextMap = {
      type: "ObjectExpression",
      properties: keys.map((key, i) => ({
        type: "Property",
        method: false,
        shorthand: false,
        computed: false,
        key: { type: "Literal", value: key, raw: JSON.stringify(key) },
        value: {
          type: "ObjectExpression",
          properties: [{
            type: "Property",
            method: false,
            shorthand: false,
            computed: false,
            key: { type: "Identifier", name: "default" },
            value: { type: "Identifier", name: modules[i] },
            kind: "init"
          }]
        },
        kind: "init"
      }))
    };

    let contextFn = {
      type: "VariableDeclaration",
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: "context" },
          init: {
            type: "ArrowFunctionExpression",
            id: null,
            expression: true,
            generator: false,
            async: false,
            params: [{ type: "Identifier", name: "id" }],
            body: {
              type: "MemberExpression",
              object: contextMap,
              property: { type: "Identifier", name: "id" },
              computed: true,
              optional: false
            }
          }
        }
      ],
      kind: "let"
    };

    let keyFn = {
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "context" },
          property: { type: "Identifier", name: "keys" },
          computed: false,
          optional: false
        },
        right: {
          type: "ArrowFunctionExpression",
          id: null,
          expression: true,
          generator: false,
          async: false,
          params: [],
          body: contextKeys
        }
      }
    };

    let contextExpr = {
      type: "CallExpression",
      callee: {
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: false,
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            contextFn,
            keyFn,
            {
              type: "ReturnStatement",
              argument: {
                type: "Identifier",
                name: "context"
              }
            }
          ]
        }
      },
      arguments: [],
      optional: false
    };

    // remove content from node (leaving source loc info)
    delete node.callee;
    delete node.arguments;
    delete node.optional;

    // replace node with expression building up a context object
    Object.assign(node, contextExpr);
  }));

  // prepend import statements
  ast.body.unshift(...imports)

  // update the list of directories to be watched
  dirWatchers[filePath] = dirs;

  // regenerate source from updated AST.
  // TODO: (optional?) sourceMaps
  return astring.generate(ast);
}

// plugin
module.exports = function (snowpackConfig, pluginOptions) {
  return {
    name: 'require-context-plugin',

    // default to processing all .js files (into .js).  Enable
    // pluginOptions.input to override which files are to be processed.
    resolve: {
      input: Array.from(pluginOptions.input || ['.js']),
      output: ['.js'],
    },

    // If a change happens in a watched directory, mark the source referencing
    // that directory as changed.
    onChange({ filePath }) {
      for (const [source, dirs] of Object.entries(dirWatchers)) {
        if (dirs.some(dir => filePath.startsWith(dir))) {
          this.markChanged(source)
        }
      }
    },

    // Load hook: invoke require_context on each file matched
    async load({ filePath }) {
      return await require_context(filePath);
    }
  }
};
