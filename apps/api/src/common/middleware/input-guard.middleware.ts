import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Deeper than any real payload (imports are an array of flat rows); stops a pathological structure from being walked or stored. */
const MAX_DEPTH = 20;
/** Enough for the largest legitimate import (5,000 rows of a few dozen columns); bounds the work done on any one request. */
const MAX_NODES = 2_000_000;

export type InputProblem = 'NUL_BYTE' | 'PROTOTYPE_KEY' | 'TOO_DEEP' | 'TOO_LARGE';

/**
 * Walks parsed input (query, body, route parameters) once and reports the first unsafe thing it sees:
 *  - a NUL character in any string or key (PostgreSQL rejects it with an error that would otherwise surface as a 500, and it is a
 *    classic filter-evasion trick);
 *  - the key `__proto__`, or `constructor` holding a `prototype`, which prototype-pollution payloads use. A JSON body can contain these
 *    as ordinary own keys, and any later code that copies keys with plain assignment would be poisoned by them;
 *  - nesting or size beyond any real request.
 * Returns null when the input is clean. Exported so the rule is unit-testable without a server.
 */
export function findInputProblem(root: unknown): InputProblem | null {
  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > MAX_NODES) return 'TOO_LARGE';
    if (typeof value === 'string') {
      if (value.includes('\u0000')) return 'NUL_BYTE';
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth > MAX_DEPTH) return 'TOO_DEEP';
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.includes('\u0000')) return 'NUL_BYTE';
      if (key === '__proto__') return 'PROTOTYPE_KEY';
      const child = record[key];
      if (key === 'constructor' && child !== null && typeof child === 'object' && Object.prototype.hasOwnProperty.call(child, 'prototype')) return 'PROTOTYPE_KEY';
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

/** True when the request target itself carries an encoded or raw NUL. */
export const urlHasNul = (url: string): boolean => /%00/i.test(url) || url.includes('\u0000');

/**
 * Rejects unsafe input with a 400 before it reaches a controller or the database. It sits in front of validation: DTO validation
 * checks the fields a route declares, this closes the generic holes that apply to every route (including routes that take a free-form
 * object such as a saved search or an import mapping).
 */
@Injectable()
export class InputGuardMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (urlHasNul(req.originalUrl || req.url || '')) return next(new BadRequestException('The request contains invalid characters'));
    const problem = findInputProblem({ query: req.query, body: req.body, params: req.params });
    if (problem) {
      return next(new BadRequestException(problem === 'NUL_BYTE' ? 'The request contains invalid characters' : 'The request contains an unsupported structure'));
    }
    next();
  }
}
