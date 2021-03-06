
// Raw
// -------
import inherits from 'inherits';
import * as helpers from './helpers';
import { EventEmitter } from 'events';

import { assign, reduce, isPlainObject, isObject, isUndefined, isNumber } from 'lodash'
import Formatter from './formatter'

import uuid from 'node-uuid';

const fakeClient = {
  formatter() {
    return new Formatter(fakeClient)
  }
}

function Raw(client = fakeClient) {
  this.client = client

  this.sql = ''
  this.bindings = []

  // Todo: Deprecate
  this._wrappedBefore = undefined
  this._wrappedAfter = undefined
  this._debug = client && client.config && client.config.debug
}
inherits(Raw, EventEmitter)

assign(Raw.prototype, {

  set(sql, bindings) {
    this.sql = sql
    this.bindings = (
      (isObject(bindings) && !bindings.toSQL) ||
      isUndefined(bindings)
    ) ? bindings : [bindings]

    return this
  },

  timeout(ms, {cancel} = {}) {
    if (isNumber(ms) && ms > 0) {
      this._timeout = ms;
      if (cancel) {
        this.client.assertCanCancelQuery();
        this._cancelOnTimeout = true;
      }
    }
    return this;
  },

  // Wraps the current sql with `before` and `after`.
  wrap(before, after) {
    this._wrappedBefore = before
    this._wrappedAfter = after
    return this
  },

  // Calls `toString` on the Knex object.
  toString() {
    return this.toQuery()
  },

  // Returns the raw sql for the query.
  toSQL(method, tz) {
    let obj
    const formatter = this.client.formatter()

    if (Array.isArray(this.bindings)) {
      obj = replaceRawArrBindings(this, formatter)
    } else if (this.bindings && isPlainObject(this.bindings)) {
      obj = replaceKeyBindings(this, formatter)
    } else {
      obj = {
        method: 'raw',
        sql: this.sql,
        bindings: isUndefined(this.bindings) ? [] : [this.bindings]
      }
    }

    if (this._wrappedBefore) {
      obj.sql = this._wrappedBefore + obj.sql
    }
    if (this._wrappedAfter) {
      obj.sql = obj.sql + this._wrappedAfter
    }

    obj.options = reduce(this._options, assign, {})

    if (this._timeout) {
      obj.timeout = this._timeout;
      if (this._cancelOnTimeout) {
        obj.cancelOnTimeout = this._cancelOnTimeout;
      }
    }

    obj.bindings = obj.bindings || [];
    if (helpers.containsUndefined(obj.bindings)) {
      throw new Error(
        `Undefined binding(s) detected when compiling RAW query: ` +
        obj.sql
      );
    }

    obj.__knexQueryUid = uuid.v4();

    return obj
  }

})

function replaceRawArrBindings(raw, formatter) {
  const expectedBindings = raw.bindings.length
  const values = raw.bindings
  let index = 0;

  const sql = raw.sql.replace(/\\?\?\??/g, function(match) {
    if (match === '\\?') {
      return match
    }

    const value = values[index++]

    if (match === '??') {
      return formatter.columnize(value)
    }
    return formatter.parameter(value)
  })

  if (expectedBindings !== index) {
    throw new Error(`Expected ${expectedBindings} bindings, saw ${index}`)
  }

  return {
    method: 'raw',
    sql,
    bindings: formatter.bindings
  }
}

function replaceKeyBindings(raw, formatter) {
  const values = raw.bindings

  let { sql } = raw

  const regex = /\\?(:\w+:?)/g
  sql = raw.sql.replace(regex, function(full, part) {
    if (full !== part) {
      return part
    }

    const key = full.trim();
    const isIdentifier = key[key.length - 1] === ':'
    const value = isIdentifier ? values[key.slice(1, -1)] : values[key.slice(1)]

    if (value === undefined) {
      formatter.bindings.push(value);
      return full;
    }

    if (isIdentifier) {
      return full.replace(key, formatter.columnize(value))
    }
    return full.replace(key, formatter.parameter(value))
  })

  return {
    method: 'raw',
    sql,
    bindings: formatter.bindings
  }
}

// Allow the `Raw` object to be utilized with full access to the relevant
// promise API.
require('./interface')(Raw)

export default Raw
