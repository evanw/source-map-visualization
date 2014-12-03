WebInspector = {};

if (!String.prototype.startsWith) {
  Object.defineProperty(String.prototype, 'startsWith', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function(searchString, position) {
      position = position || 0;
      return this.lastIndexOf(searchString, position) === position;
    }
  });
}
if (!String.prototype.endsWith) {
  Object.defineProperty(String.prototype, 'endsWith', {
    value: function(searchString, position) {
      var subjectString = this.toString();
      if (position === undefined || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.indexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
    }
  });
}
/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

WebInspector.ParsedURL = function(url)
{
    this.isValid = false;
    this.url = url;
    this.scheme = "";
    this.host = "";
    this.port = "";
    this.path = "";
    this.queryParams = "";
    this.fragment = "";
    this.folderPathComponents = "";
    this.lastPathComponent = "";

    // RegExp groups:
    // 1 - scheme (using the RFC3986 grammar)
    // 2 - hostname
    // 3 - ?port
    // 4 - ?path
    // 5 - ?fragment
    var match = url.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\s\/:]*)(?::([\d]+))?(?:(\/[^#]*)(?:#(.*))?)?$/i);
    if (match) {
        this.isValid = true;
        this.scheme = match[1].toLowerCase();
        this.host = match[2];
        this.port = match[3];
        this.path = match[4] || "/";
        this.fragment = match[5];
    } else {
        if (this.url.startsWith("data:")) {
            this.scheme = "data";
            return;
        }
        if (this.url === "about:blank") {
            this.scheme = "about";
            return;
        }
        this.path = this.url;
    }

    // First cut the query params.
    var path = this.path;
    var indexOfQuery = path.indexOf("?");
    if (indexOfQuery !== -1) {
        this.queryParams = path.substring(indexOfQuery + 1)
        path = path.substring(0, indexOfQuery);
    }

    // Then take last path component.
    var lastSlashIndex = path.lastIndexOf("/");
    if (lastSlashIndex !== -1) {
        this.folderPathComponents = path.substring(0, lastSlashIndex);
        this.lastPathComponent = path.substring(lastSlashIndex + 1);
    } else
        this.lastPathComponent = path;
}

/**
 * @param {string} url
 * @return {string}
 */
WebInspector.ParsedURL._decodeIfPossible = function(url)
{
    var decodedURL = url;
    try {
        decodedURL = decodeURI(url);
    } catch (e) { }
    return decodedURL;
}

/**
 * @param {string} url
 * @return {!Array.<string>}
 */
WebInspector.ParsedURL.splitURLIntoPathComponents = function(url)
{
    var decodedURL = WebInspector.ParsedURL._decodeIfPossible(url);
    var parsedURL = new WebInspector.ParsedURL(decodedURL);
    var origin;
    var folderPath;
    var name;
    if (parsedURL.isValid) {
        origin = parsedURL.scheme + "://" + parsedURL.host;
        if (parsedURL.port)
            origin += ":" + parsedURL.port;
        folderPath = parsedURL.folderPathComponents;
        name = parsedURL.lastPathComponent;
        if (parsedURL.queryParams)
            name += "?" + parsedURL.queryParams;
    } else {
        origin = "";
        folderPath = "";
        name = url;
    }
    var result = [origin];
    var splittedPath = folderPath.split("/");
    for (var i = 1; i < splittedPath.length; ++i) {
        if (!splittedPath[i])
            continue;
        result.push(splittedPath[i]);
    }
    result.push(name);
    return result;
}

/**
 * @param {string} baseURL
 * @param {string} href
 * @return {?string}
 */
WebInspector.ParsedURL.completeURL = function(baseURL, href)
{
    if (href) {
        // Return special URLs as-is.
        var trimmedHref = href.trim();
        if (trimmedHref.startsWith("data:") || trimmedHref.startsWith("blob:") || trimmedHref.startsWith("javascript:"))
            return href;

        // Return absolute URLs as-is.
        var parsedHref = trimmedHref.asParsedURL();
        if (parsedHref && parsedHref.scheme)
            return trimmedHref;
    } else {
        return baseURL;
    }

    var parsedURL = baseURL.asParsedURL();
    if (parsedURL) {
        if (parsedURL.isDataURL())
            return href;
        var path = href;

        var query = path.indexOf("?");
        var postfix = "";
        if (query !== -1) {
            postfix = path.substring(query);
            path = path.substring(0, query);
        } else {
            var fragment = path.indexOf("#");
            if (fragment !== -1) {
                postfix = path.substring(fragment);
                path = path.substring(0, fragment);
            }
        }

        if (!path) {  // empty path, must be postfix
            var basePath = parsedURL.path;
            if (postfix.charAt(0) === "?") {
                // A href of "?foo=bar" implies "basePath?foo=bar".
                // With "basePath?a=b" and "?foo=bar" we should get "basePath?foo=bar".
                var baseQuery = parsedURL.path.indexOf("?");
                if (baseQuery !== -1)
                    basePath = basePath.substring(0, baseQuery);
            } // else it must be a fragment
            return parsedURL.scheme + "://" + parsedURL.host + (parsedURL.port ? (":" + parsedURL.port) : "") + basePath + postfix;
        } else if (path.charAt(0) !== "/") {  // relative path
            var prefix = parsedURL.path;
            var prefixQuery = prefix.indexOf("?");
            if (prefixQuery !== -1)
                prefix = prefix.substring(0, prefixQuery);
            prefix = prefix.substring(0, prefix.lastIndexOf("/")) + "/";
            path = prefix + path;
        } else if (path.length > 1 && path.charAt(1) === "/") {
            // href starts with "//" which is a full URL with the protocol dropped (use the baseURL protocol).
            return parsedURL.scheme + ":" + path + postfix;
        }  // else absolute path
        return parsedURL.scheme + "://" + parsedURL.host + (parsedURL.port ? (":" + parsedURL.port) : "") + normalizePath(path) + postfix;
    }
    return null;
}

WebInspector.ParsedURL.prototype = {
    get displayName()
    {
        if (this._displayName)
            return this._displayName;

        if (this.isDataURL())
            return this.dataURLDisplayName();
        if (this.isAboutBlank())
            return this.url;

        this._displayName = this.lastPathComponent;
        if (!this._displayName)
            this._displayName = (this.host || "") + "/";
        if (this._displayName === "/")
            this._displayName = this.url;
        return this._displayName;
    },

    /**
     * @return {string}
     */
    dataURLDisplayName: function()
    {
        if (this._dataURLDisplayName)
            return this._dataURLDisplayName;
        if (!this.isDataURL())
            return "";
        this._dataURLDisplayName = this.url.trimEnd(20);
        return this._dataURLDisplayName;
    },

    /**
     * @return {boolean}
     */
    isAboutBlank: function()
    {
        return this.url === "about:blank";
    },

    /**
     * @return {boolean}
     */
    isDataURL: function()
    {
        return this.scheme === "data";
    }
}

/**
 * @param {string} string
 * @return {?{url: string, lineNumber: (number|undefined), columnNumber: (number|undefined)}}
 */
WebInspector.ParsedURL.splitLineAndColumn = function(string)
{
    var lineColumnRegEx = /:(\d+)(:(\d+))?$/;
    var lineColumnMatch = lineColumnRegEx.exec(string);
    var lineNumber;
    var columnNumber;
    if (!lineColumnMatch)
        return null;

    lineNumber = parseInt(lineColumnMatch[1], 10);
    // Immediately convert line and column to 0-based numbers.
    lineNumber = isNaN(lineNumber) ? undefined : lineNumber - 1;
    if (typeof(lineColumnMatch[3]) === "string") {
        columnNumber = parseInt(lineColumnMatch[3], 10);
        columnNumber = isNaN(columnNumber) ? undefined : columnNumber - 1;
    }

    return { url: string.substring(0, string.length - lineColumnMatch[0].length), lineNumber: lineNumber, columnNumber: columnNumber};
}

/**
 * @return {?WebInspector.ParsedURL}
 */
String.prototype.asParsedURL = function()
{
    var parsedURL = new WebInspector.ParsedURL(this.toString());
    if (parsedURL.isValid)
        return parsedURL;
    return null;
}

/**
 * @constructor
 */
function SourceMapV3()
{
    /** @type {number} */ this.version;
    /** @type {string|undefined} */ this.file;
    /** @type {!Array.<string>} */ this.sources;
    /** @type {!Array.<!SourceMapV3.Section>|undefined} */ this.sections;
    /** @type {string} */ this.mappings;
    /** @type {string|undefined} */ this.sourceRoot;
}

/**
 * @constructor
 */
SourceMapV3.Section = function()
{
    /** @type {!SourceMapV3} */ this.map;
    /** @type {!SourceMapV3.Offset} */ this.offset;
}

/**
 * @constructor
 */
SourceMapV3.Offset = function()
{
    /** @type {number} */ this.line;
    /** @type {number} */ this.column;
}

/**
 * Implements Source Map V3 model. See http://code.google.com/p/closure-compiler/wiki/SourceMaps
 * for format description.
 * @constructor
 * @param {string} sourceMappingURL
 * @param {!SourceMapV3} payload
 */
WebInspector.SourceMap = function(sourceMappingURL, payload)
{
    if (!WebInspector.SourceMap.prototype._base64Map) {
        const base64Digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        WebInspector.SourceMap.prototype._base64Map = {};
        for (var i = 0; i < base64Digits.length; ++i)
            WebInspector.SourceMap.prototype._base64Map[base64Digits.charAt(i)] = i;
    }

    this._sourceMappingURL = sourceMappingURL;
    this._reverseMappingsBySourceURL = {};
    this._mappings = [];
    this._sources = {};
    this._sourceContentByURL = {};
    this._parseMappingPayload(payload);
}

/**
 * @param {string} sourceMapURL
 * @param {string} compiledURL
 * @param {function(?WebInspector.SourceMap)} callback
 * @this {WebInspector.SourceMap}
 */
WebInspector.SourceMap.load = function(sourceMapURL, compiledURL, callback)
{
    var resourceTreeModel = WebInspector.resourceTreeModel;
    if (resourceTreeModel.cachedResourcesLoaded())
        loadResource();
    else
        resourceTreeModel.addEventListener(WebInspector.ResourceTreeModel.EventTypes.CachedResourcesLoaded, cachedResourcesLoaded);

    function cachedResourcesLoaded()
    {
        resourceTreeModel.removeEventListener(WebInspector.ResourceTreeModel.EventTypes.CachedResourcesLoaded, cachedResourcesLoaded);
        loadResource();
    }

    function loadResource()
    {
        var headers = {};
        NetworkAgent.loadResourceForFrontend(resourceTreeModel.mainFrame.id, sourceMapURL, headers, contentLoaded);
    }

    /**
     * @param {?Protocol.Error} error
     * @param {number} statusCode
     * @param {!NetworkAgent.Headers} headers
     * @param {string} content
     */
    function contentLoaded(error, statusCode, headers, content)
    {
        if (error || !content || statusCode >= 400) {
            callback(null);
            return;
        }

        if (content.slice(0, 3) === ")]}")
            content = content.substring(content.indexOf('\n'));
        try {
            var payload = /** @type {!SourceMapV3} */ (JSON.parse(content));
            var baseURL = sourceMapURL.startsWith("data:") ? compiledURL : sourceMapURL;
            callback(new WebInspector.SourceMap(baseURL, payload));
        } catch(e) {
            console.error(e.message);
            callback(null);
        }
    }
}

WebInspector.SourceMap.prototype = {
    /**
     * @return {string}
     */
    url: function()
    {
        return this._sourceMappingURL;
    },

   /**
     * @return {!Array.<string>}
     */
    sources: function()
    {
        return Object.keys(this._sources);
    },

    /**
     * @param {string} sourceURL
     * @return {string|undefined}
     */
    sourceContent: function(sourceURL)
    {
        return this._sourceContentByURL[sourceURL];
    },

    /**
     * @param {string} sourceURL
     * @param {!WebInspector.ResourceType} contentType
     * @return {!WebInspector.ContentProvider}
     */
    sourceContentProvider: function(sourceURL, contentType)
    {
        var sourceContent = this.sourceContent(sourceURL);
        if (sourceContent)
            return new WebInspector.StaticContentProvider(contentType, sourceContent);
        return new WebInspector.CompilerSourceMappingContentProvider(sourceURL, contentType);
    },

    /**
     * @param {!SourceMapV3} mappingPayload
     */
    _parseMappingPayload: function(mappingPayload)
    {
        if (mappingPayload.sections)
            this._parseSections(mappingPayload.sections);
        else
            this._parseMap(mappingPayload, 0, 0);
    },

    /**
     * @param {!Array.<!SourceMapV3.Section>} sections
     */
    _parseSections: function(sections)
    {
        for (var i = 0; i < sections.length; ++i) {
            var section = sections[i];
            this._parseMap(section.map, section.offset.line, section.offset.column);
        }
    },

    /**
     * @param {number} lineNumber in compiled resource
     * @param {number} columnNumber in compiled resource
     * @return {?Array.<number|string>}
     */
    findEntry: function(lineNumber, columnNumber)
    {
        var first = 0;
        var count = this._mappings.length;
        while (count > 1) {
          var step = count >> 1;
          var middle = first + step;
          var mapping = this._mappings[middle];
          if (lineNumber < mapping[0] || (lineNumber === mapping[0] && columnNumber < mapping[1]))
              count = step;
          else {
              first = middle;
              count -= step;
          }
        }
        var entry = this._mappings[first];
        if (!first && entry && (lineNumber < entry[0] || (lineNumber === entry[0] && columnNumber < entry[1])))
            return null;
        return entry;
    },

    /**
     * @param {string} sourceURL of the originating resource
     * @param {number} lineNumber in the originating resource
     * @param {number=} span
     * @return {?Array.<*>}
     */
    findEntryReversed: function(sourceURL, lineNumber, span)
    {
        var mappings = this._reverseMappingsBySourceURL[sourceURL];
        var maxLineNumber = typeof span === "number" ? Math.min(lineNumber + span + 1, mappings.length) : mappings.length;
        for ( ; lineNumber < maxLineNumber; ++lineNumber) {
            var mapping = mappings[lineNumber];
            if (mapping)
                return mapping;
        }
        return null;
    },

    /**
     * @param {!SourceMapV3} map
     * @param {number} lineNumber
     * @param {number} columnNumber
     */
    _parseMap: function(map, lineNumber, columnNumber)
    {
        var sourceIndex = 0;
        var sourceLineNumber = 0;
        var sourceColumnNumber = 0;
        var nameIndex = 0;

        var sources = [];
        var originalToCanonicalURLMap = {};
        for (var i = 0; i < map.sources.length; ++i) {
            var originalSourceURL = map.sources[i];
            var sourceRoot = map.sourceRoot || "";
            if (sourceRoot && !sourceRoot.endsWith("/"))
                sourceRoot += "/";
            var href = sourceRoot + originalSourceURL;
            var url = WebInspector.ParsedURL.completeURL(this._sourceMappingURL, href) || href;
            originalToCanonicalURLMap[originalSourceURL] = url;
            sources.push(url);
            this._sources[url] = true;

            if (map.sourcesContent && map.sourcesContent[i])
                this._sourceContentByURL[url] = map.sourcesContent[i];
        }

        var stringCharIterator = new WebInspector.SourceMap.StringCharIterator(map.mappings);
        var sourceURL = sources[sourceIndex];

        while (true) {
            if (stringCharIterator.peek() === ",")
                stringCharIterator.next();
            else {
                while (stringCharIterator.peek() === ";") {
                    lineNumber += 1;
                    columnNumber = 0;
                    stringCharIterator.next();
                }
                if (!stringCharIterator.hasNext())
                    break;
            }

            columnNumber += this._decodeVLQ(stringCharIterator);
            if (!stringCharIterator.hasNext() || this._isSeparator(stringCharIterator.peek())) {
                this._mappings.push([lineNumber, columnNumber]);
                continue;
            }

            var sourceIndexDelta = this._decodeVLQ(stringCharIterator);
            if (sourceIndexDelta) {
                sourceIndex += sourceIndexDelta;
                sourceURL = sources[sourceIndex];
            }
            sourceLineNumber += this._decodeVLQ(stringCharIterator);
            sourceColumnNumber += this._decodeVLQ(stringCharIterator);
            if (!this._isSeparator(stringCharIterator.peek()))
                nameIndex += this._decodeVLQ(stringCharIterator);

            this._mappings.push([lineNumber, columnNumber, sourceURL, sourceLineNumber, sourceColumnNumber]);
        }

        for (var i = 0; i < this._mappings.length; ++i) {
            var mapping = this._mappings[i];
            var url = mapping[2];
            if (!url)
                continue;
            if (!this._reverseMappingsBySourceURL[url])
                this._reverseMappingsBySourceURL[url] = [];
            var reverseMappings = this._reverseMappingsBySourceURL[url];
            var sourceLine = mapping[3];
            if (!reverseMappings[sourceLine])
                reverseMappings[sourceLine] = [mapping[0], mapping[1]];
        }
    },

    /**
     * @param {string} char
     * @return {boolean}
     */
    _isSeparator: function(char)
    {
        return char === "," || char === ";";
    },

    /**
     * @param {!WebInspector.SourceMap.StringCharIterator} stringCharIterator
     * @return {number}
     */
    _decodeVLQ: function(stringCharIterator)
    {
        // Read unsigned value.
        var result = 0;
        var shift = 0;
        do {
            var digit = this._base64Map[stringCharIterator.next()];
            result += (digit & this._VLQ_BASE_MASK) << shift;
            shift += this._VLQ_BASE_SHIFT;
        } while (digit & this._VLQ_CONTINUATION_MASK);

        // Fix the sign.
        var negative = result & 1;
        result >>= 1;
        return negative ? -result : result;
    },

    _VLQ_BASE_SHIFT: 5,
    _VLQ_BASE_MASK: (1 << 5) - 1,
    _VLQ_CONTINUATION_MASK: 1 << 5
}

/**
 * @constructor
 * @param {string} string
 */
WebInspector.SourceMap.StringCharIterator = function(string)
{
    this._string = string;
    this._position = 0;
}

WebInspector.SourceMap.StringCharIterator.prototype = {
    /**
     * @return {string}
     */
    next: function()
    {
        return this._string.charAt(this._position++);
    },

    /**
     * @return {string}
     */
    peek: function()
    {
        return this._string.charAt(this._position);
    },

    /**
     * @return {boolean}
     */
    hasNext: function()
    {
        return this._position < this._string.length;
    }
}
