/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every language family the outline claims to understand, asserted on a real
 * snippet of each.
 *
 * The table is the coverage contract: a language id the editor can open must
 * produce rows from idiomatic source, or say so honestly (only `diff` and a
 * language with no entry answer nothing). The `LANG_LOADERS` check at the
 * bottom is what keeps that true when a grammar is added upstream — a new id
 * with no scan entry would render an empty section for every file of that
 * language, which looks like a file with no symbols rather than a gap.
 */

import { describe, expect, test } from 'bun:test';
import { extractOutline } from '@/shared/lib/code/outline/extract';
import { SCAN_BY_LANGUAGE } from '@/shared/lib/code/outline/scan';
import { LANG_LOADERS } from '@/shared/lib/code/shiki-langs';

/** `kind:name@line` — the shape that makes a wrong line visible at a glance. */
const rows = (language: string, text: string) => extractOutline(text, language).map((s) => `${s.kind}:${s.name}@${s.line}`);

interface Sample {
  language: string;
  source: string;
  expected: string[];
}

const SAMPLES: Sample[] = [
  {
    language: 'java',
    source: ['package a.b;', 'public class Server {', '  private int port;', '  public void start(int port) {', '    this.port = port;', '  }', '}'].join('\n'),
    expected: ['module:a.b@1', 'class:Server@2', 'variable:port@3', 'method:start@4'],
  },
  {
    language: 'csharp',
    source: ['namespace App {', '  public class Repo {', '    private string name;', '    public void Save() {}', '  }', '}'].join('\n'),
    expected: ['module:App@1', 'class:Repo@2', 'variable:name@3', 'method:Save@4'],
  },
  {
    language: 'kotlin',
    source: ['class Cache {', '  val size = 0', '  fun clear() {}', '}', 'fun main() {}'].join('\n'),
    expected: ['class:Cache@1', 'variable:size@2', 'method:clear@3', 'function:main@5'],
  },
  {
    language: 'swift',
    source: ['struct Point {', '  let x = 0', '  func move() {}', '}', 'enum Mode { case a }'].join('\n'),
    expected: ['struct:Point@1', 'variable:x@2', 'method:move@3', 'enum:Mode@5'],
  },
  {
    language: 'scala',
    source: ['object Main {', '  def run(): Unit = {}', '}', 'trait Store {', '  def get(): Int', '}'].join('\n'),
    expected: ['class:Main@1', 'method:run@2', 'trait:Store@4', 'method:get@5'],
  },
  {
    language: 'dart',
    source: ['class Box {', '  int size = 0;', '  void grow() {}', '}', 'enum Mode { a }'].join('\n'),
    expected: ['class:Box@1', 'variable:size@2', 'method:grow@3', 'enum:Mode@5'],
  },
  {
    language: 'php',
    source: ['<?php', 'class Repo {', '  public function save() {}', '}', 'function helper() {}'].join('\n'),
    expected: ['class:Repo@2', 'method:save@3', 'function:helper@5'],
  },
  {
    language: 'ruby',
    source: ['module Shop', '  class Cart', '    def total', '    end', '  end', 'end', 'def helper', 'end'].join('\n'),
    expected: ['module:Shop@1', 'class:Cart@2', 'function:total@3', 'function:helper@7'],
  },
  {
    language: 'lua',
    source: ['local M = {}', 'function M.start()', 'end', 'local function helper()', 'end'].join('\n'),
    expected: ['variable:M@1', 'function:M.start@2', 'function:helper@4'],
  },
  {
    language: 'elixir',
    source: ['defmodule Shop.Cart do', '  def total do', '  end', '  defp hidden, do: 1', 'end'].join('\n'),
    expected: ['module:Shop.Cart@1', 'function:total@2', 'function:hidden@4'],
  },
  {
    language: 'erlang',
    source: ['-module(shop).', 'start(Args) -> ok.', 'helper() -> ok.'].join('\n'),
    expected: ['module:shop@1', 'function:start@2', 'function:helper@3'],
  },
  {
    language: 'haskell',
    source: ['module Shop where', 'data Cart = Cart Int', 'class Store a where', 'total :: Cart -> Int', 'total c = 0'].join('\n'),
    expected: ['module:Shop@1', 'type:Cart@2', 'class:Store@3', 'function:total@4'],
  },
  {
    language: 'ocaml',
    source: ['module Shop = struct', 'type cart = int', 'let total c = 0', 'end'].join('\n'),
    expected: ['module:Shop@1', 'type:cart@2', 'function:total@3'],
  },
  {
    language: 'julia',
    source: ['module Shop', 'struct Cart', '  n::Int', 'end', 'function total(c)', 'end', 'const LIMIT = 1'].join('\n'),
    expected: ['module:Shop@1', 'struct:Cart@2', 'function:total@5', 'constant:LIMIT@7'],
  },
  {
    language: 'r',
    source: ['total <- function(cart) {', '  sum(cart)', '}', 'LIMIT <- 3'].join('\n'),
    expected: ['function:total@1', 'variable:LIMIT@4'],
  },
  {
    language: 'sql',
    source: ['CREATE TABLE orders (id INT);', 'CREATE FUNCTION total(x INT) RETURNS INT AS $$ SELECT 1 $$;'].join('\n'),
    expected: ['class:orders@1', 'function:total@2'],
  },
  {
    language: 'bash',
    source: ['#!/bin/sh', 'greet() {', '  echo hi', '}', 'NAME=shop'].join('\n'),
    expected: ['function:greet@2', 'variable:NAME@5'],
  },
  {
    language: 'makefile',
    source: ['CC = clang', 'build: main.o', '\t$(CC) -o app main.o'].join('\n'),
    expected: ['variable:CC@1', 'function:build@2'],
  },
  {
    language: 'dockerfile',
    source: ['FROM oven/bun:1 AS build', 'ARG VERSION', 'RUN bun install'].join('\n'),
    expected: ['module:build@1', 'variable:VERSION@2'],
  },
  {
    language: 'toml',
    source: ['[package]', 'name = "x"', '[dependencies]', 'zod = "^4"'].join('\n'),
    expected: ['module:package@1', 'key:name@2', 'module:dependencies@3', 'key:zod@4'],
  },
  {
    language: 'ini',
    source: ['[core]', 'editor = vim', 'excludes = a'].join('\n'),
    expected: ['module:core@1', 'key:editor@2', 'key:excludes@3'],
  },
  {
    language: 'yaml',
    source: ['name: build', 'on:', '  push: {}', 'jobs: {}'].join('\n'),
    expected: ['key:name@1', 'key:on@2', 'key:push@3', 'key:jobs@4'],
  },
  {
    language: 'json',
    source: ['{', '  "name": "x",', '  "deps": {', '    "zod": "1"', '  }', '}'].join('\n'),
    expected: ['key:name@2', 'key:deps@3'],
  },
  {
    language: 'html',
    source: ['<main id="app">', '  <Widget />', '  <div id="x">', '</main>'].join('\n'),
    expected: ['tag:app@1', 'tag:Widget@2', 'tag:x@3'],
  },
  {
    language: 'css',
    source: [':root {', '  --gap: 4px;', '}', '.card {', '  color: red;', '}'].join('\n'),
    expected: ['selector::root@1', 'variable:--gap@2', 'selector:.card@4'],
  },
  {
    language: 'scss',
    source: ['$gap: 4px;', '@mixin pad {', '}', '.card { }'].join('\n'),
    expected: ['variable:$gap@1', 'macro:@mixin pad@2', 'selector:.card@4'],
  },
  {
    language: 'go',
    source: ['package main', 'type Server struct {}', 'func New() *Server { return nil }'].join('\n'),
    expected: ['struct:Server@2', 'function:New@3'],
  },
  {
    language: 'rust',
    source: ['pub struct Cache {}', 'impl Cache {', '  pub fn new() -> Self { Self {} }', '}'].join('\n'),
    expected: ['struct:Cache@1', 'impl:Cache@2', 'method:new@3'],
  },
  {
    language: 'zig',
    source: ['const Cache = struct {', '  size: usize,', '};', 'pub fn main() void {}'].join('\n'),
    expected: ['struct:Cache@1', 'function:main@4'],
  },
  {
    language: 'hcl',
    source: ['resource "aws_instance" "web" {', '  ami = "x"', '}'].join('\n'),
    expected: ['module:aws_instance@1'],
  },
  {
    language: 'protobuf',
    source: ['message User {', '  string name = 1;', '}', 'service Api {', '  rpc Get(User) returns (User);', '}'].join('\n'),
    expected: ['class:User@1', 'interface:Api@4', 'method:Get@5'],
  },
  {
    language: 'graphql',
    source: ['type User {', '  name: String', '}', 'query getUser { user { name } }'].join('\n'),
    expected: ['class:User@1', 'function:getUser@4'],
  },
  {
    language: 'solidity',
    source: ['contract Bank {', '  function deposit() public {}', '  event Paid(address who);', '}'].join('\n'),
    expected: ['class:Bank@1', 'method:deposit@2', 'variable:Paid@3'],
  },
  {
    language: 'powershell',
    source: ['function Get-Thing {', '}', 'class Repo {', '}'].join('\n'),
    expected: ['function:Get-Thing@1', 'class:Repo@3'],
  },
  {
    language: 'perl',
    source: ['package Shop::Cart;', 'sub total {', '}'].join('\n'),
    expected: ['module:Shop::Cart@1', 'function:total@2'],
  },
  {
    language: 'clojure',
    source: ['(ns shop.cart)', '(defn total [c] 0)', '(def limit 3)'].join('\n'),
    expected: ['module:shop.cart@1', 'function:total@2', 'variable:limit@3'],
  },
  {
    language: 'scheme',
    source: ['(define-module (shop cart))', '(define (total c) 0)'].join('\n'),
    expected: ['module:shop@1', 'function:total@2'],
  },
  {
    language: 'nix',
    source: ['{ pkgs }:', '{', '  build = { };', '  run = pkgs.hello;', '}'].join('\n'),
    expected: ['function:build@3', 'variable:run@4'],
  },
];

describe('language coverage', () => {
  for (const sample of SAMPLES) {
    test(sample.language, () => {
      expect(rows(sample.language, sample.source)).toEqual(sample.expected);
    });
  }

  test('every grammar the highlighter can load has a scan entry', () => {
    const missing = Object.keys(LANG_LOADERS).filter((id) => !SCAN_BY_LANGUAGE[id]);
    expect(missing).toEqual([]);
  });

  test('a comment does not declare anything in the languages with distinctive markers', () => {
    expect(rows('ruby', '# def fake\n# class Fake')).toEqual([]);
    expect(rows('lua', "-- function fake()\n--[[ function x() ]]" )).toEqual([]);
    expect(rows('sql', '-- CREATE TABLE fake (id INT);')).toEqual([]);
    expect(rows('ocaml', '(* let fake = 1 *)')).toEqual([]);
    expect(rows('clojure', '; (defn fake [] 1)')).toEqual([]);
    expect(rows('haskell', '-- data Fake = Fake')).toEqual([]);
    expect(rows('erlang', '%% fake() -> ok.')).toEqual([]);
  });
});
