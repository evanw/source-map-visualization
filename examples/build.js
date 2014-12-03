#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

function createExample(name, dir, original, generated, map) {
  return {
    name: name,
    original: fs.readFileSync(path.join(__dirname, dir, original), 'utf8'),
    generated: fs.readFileSync(path.join(__dirname, dir, generated), 'utf8'),
    map: fs.readFileSync(path.join(__dirname, dir, map), 'utf8'),
  };
}

function run(command, done) {
  console.log(command.join(' '));
  child_process.spawn(command[0], command.slice(1), { stdio: 'inherit' }).on('exit', done);
}

// Compile code
run([
  path.join(__dirname, '../node_modules/coffee-script/bin/coffee'), '-c', '-m',
  path.join(__dirname, 'coffee-script/original.coffee')], function() {
run([
  path.join(__dirname, '../node_modules/coffee-script-redux/bin/coffee'), '--js', '--input',
  path.join(__dirname, 'coffee-script-redux/original.coffee'), '--output',
  path.join(__dirname, 'coffee-script-redux/generated.js')], function() {
run([
  path.join(__dirname, '../node_modules/coffee-script-redux/bin/coffee'), '--source-map', '--input',
  path.join(__dirname, 'coffee-script-redux/original.coffee'), '--output',
  path.join(__dirname, 'coffee-script-redux/generated.js.map')], function() {
run([
  path.join(__dirname, '../node_modules/typescript/bin/tsc'), '-sourcemap',
  path.join(__dirname, 'typescript/original.ts')], function() {
run([
  path.join(__dirname, '../node_modules/jsx/bin/jsx'), '--enable-source-map', '--output',
  path.join(__dirname, 'jsx/generated.js'),
  path.join(__dirname, 'jsx/original.jsx')], function() {

  // Create examples
  examples = [
    createExample('Simple', 'simple', 'original.js', 'generated.js', 'generated.js.map'),
    createExample('CoffeeScript', 'coffee-script', 'original.coffee', 'original.js', 'original.js.map'),
    createExample('CoffeeScriptRedux', 'coffee-script-redux', 'original.coffee', 'generated.js', 'generated.js.map'),
    createExample('TypeScript', 'typescript', 'original.ts', 'original.js', 'original.js.map'),
    createExample('JSX', 'jsx', 'original.jsx', 'generated.js', 'generated.js.mapping'),
    createExample('Haxe', 'haxe', 'Original.hx', 'generated.js', 'generated.js.map'),
    createExample('Stassets', 'stassets', 'original.coffee', 'generated.js', 'generated.js.map'),
  ]

  fs.writeFileSync('../examples.js', 'var examples = ' + JSON.stringify(examples) + ';\n');
}); }); }); }); });
