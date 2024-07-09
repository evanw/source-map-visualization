import './style.css';
import { Promisable } from 'type-fest';
import { $, $assert, assert } from './utils';
import { RawIndexMap, RawSourceMap } from 'source-map';

////////////////////////////////////////////////////////////////////////////////
// Dragging

const dragTarget = $('#dragTarget');
const uploadFiles = $('#uploadFiles');
const loadExample = $('#loadExample');

let dragging = 0;
let filesInput: HTMLInputElement;

function isFilesDragEvent(e: DragEvent) {
  return (
    e.dataTransfer &&
    e.dataTransfer.types &&
    Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1
  );
}

document.ondragover = e => {
  e.preventDefault();
};

document.ondragenter = e => {
  e.preventDefault();
  if (!isFilesDragEvent(e)) return;
  dragTarget.style.display = 'block';
  dragging++;
};

document.ondragleave = e => {
  e.preventDefault();
  if (!isFilesDragEvent(e)) return;
  if (--dragging === 0) dragTarget.style.display = 'none';
};

document.ondrop = e => {
  e.preventDefault();
  dragTarget.style.display = 'none';
  dragging = 0;
  if (e.dataTransfer && e.dataTransfer.files)
    startLoading(e.dataTransfer.files);
};

uploadFiles.onclick = () => {
  if (filesInput) document.body.removeChild(filesInput);
  filesInput = document.createElement('input');
  filesInput.type = 'file';
  filesInput.multiple = true;
  filesInput.style.display = 'none';
  document.body.appendChild(filesInput);
  filesInput.click();
  filesInput.onchange = () =>
    filesInput.files && startLoading(filesInput.files);
};

loadExample.onclick = () => {
  finishLoading(exampleJS, exampleMap);
};

////////////////////////////////////////////////////////////////////////////////
// Loading

const utf8ToUTF16 = (x: string) => decodeURIComponent(escape(x));
const utf16ToUTF8 = (x: string) => unescape(encodeURIComponent(x));

const promptText = $('#promptText');
const errorText = $('#errorText');
const toolbar = $('#toolbar');
const statusBar = $('#statusBar');
const progressBarOverlay = $('#progressBar');
const progressBar = $('#progressBar .progress');
const originalStatus = $('#originalStatus');
const generatedStatus = $('#generatedStatus');
const fileList = $('select#fileList');

function isProbablySourceMap(file: File) {
  return file.name.endsWith('.map') || file.name.endsWith('.json');
}

function loadFile(file: File) {
  return new Promise<string | null>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onloadend = () => resolve(reader.result && reader.result.toString());
    reader.readAsText(file);
  });
}

function resetLoadingState() {
  promptText.style.display = 'block';
  toolbar.style.display = 'none';
  statusBar.style.display = 'none';
  canvas.style.display = 'none';
}

function showLoadingError(text: string) {
  resetLoadingState();
  errorText.style.display = 'block';
  errorText.textContent = text;

  // Push an empty hash since the state has been cleared
  if (location.hash !== '') {
    try {
      history.pushState({}, '', location.pathname);
    } catch (e) { }
  }
}

async function finishLoadingCodeWithEmbeddedSourceMap(
  code: string,
  file: File | null,
) {
  let url = '';
  let match: RegExpExecArray | null;

  // Check for both "//" and "/*" comments. This is mostly done manually
  // instead of doing it all with a regular expression because Firefox's
  // regular expression engine crashes with an internal error when the
  // match is too big.
  for (
    let regex = /\/([*/])[#@] *sourceMappingURL=/g;
    (match = regex.exec(code));

  ) {
    const start = match.index + match[0].length;
    const n = code.length;
    let end = start;
    while (end < n && code.charCodeAt(end) > 32) {
      end++;
    }
    if (
      end > start &&
      (match[1] === '/' || code.slice(end).indexOf('*/') > 0)
    ) {
      url = code.slice(start, end);
      break;
    }
  }

  // Check for a non-empty data URL payload
  if (url) {
    let map;
    try {
      // Use "new URL" to ensure that the URL has a protocol (e.g. "data:" or "https:")
      map = await fetch(new URL(url)).then(r => r.text());
    } catch (e) {
      assert(e instanceof Error);
      assert(match);
      showLoadingError(
        `Failed to parse the URL in the "/${match[1]
        }# sourceMappingURL=" comment: ${(e && e.message) || e}`,
      );
      return;
    }
    finishLoading(code, map);
  } else if (file && isProbablySourceMap(file)) {
    // Allow loading a source map without a generated file because why not
    finishLoading('', code);
  } else {
    const c = file && file.name.endsWith('ss') ? '*' : '/';
    showLoadingError(
      `Failed to find an embedded "/${c}# sourceMappingURL=" comment in the ${file ? 'imported file' : 'pasted text'
      }.`,
    );
  }
}

async function startLoading(files: FileList) {
  if (files.length === 1) {
    const file0 = files[0];
    const code = await loadFile(file0);
    assert(code);
    finishLoadingCodeWithEmbeddedSourceMap(code, file0);
  } else if (files.length === 2) {
    const file0 = files[0];
    const file1 = files[1];

    if (isProbablySourceMap(file0)) {
      const codePromise = loadFile(file1);
      const mapPromise = loadFile(file0);
      const code = await codePromise;
      const map = await mapPromise;
      assert(code && map);
      finishLoading(code, map);
    } else if (isProbablySourceMap(file1)) {
      const codePromise = loadFile(file0);
      const mapPromise = loadFile(file1);
      const code = await codePromise;
      const map = await mapPromise;
      assert(code && map);
      finishLoading(code, map);
    } else {
      showLoadingError(
        `The source map file must end in either ".map" or ".json" to be detected.`,
      );
    }
  } else {
    showLoadingError(`Please import either 1 or 2 files.`);
  }
}

document.body.addEventListener('paste', e => {
  e.preventDefault();
  const { clipboardData } = e;
  assert(clipboardData);
  const code = clipboardData.getData('text/plain');
  finishLoadingCodeWithEmbeddedSourceMap(code, null);
});

// Accelerate VLQ decoding with a lookup table
const vlqTable = new Uint8Array(128);
const vlqChars =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < vlqTable.length; i++) vlqTable[i] = 0xff;
for (let i = 0; i < vlqChars.length; i++) vlqTable[vlqChars.charCodeAt(i)] = i;

function decodeMappings(
  mappings: string,
  sourcesCount: number,
  namesCount: number,
) {
  const n = mappings.length;
  let data = new Int32Array(1024);
  let dataLength = 0;
  let generatedLine = 0;
  let generatedLineStart = 0;
  let generatedColumn = 0;
  let originalSource = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let originalName = 0;
  let needToSortGeneratedColumns = false;
  let i = 0;

  function decodeError(text: string) {
    const error = `Invalid VLQ data at index ${i}: ${text}`;
    showLoadingError(
      `The "mappings" field of the imported source map contains invalid data. ${error}.`,
    );
    throw new Error(error);
  }

  function decodeVLQ() {
    let shift = 0;
    let vlq = 0;

    // Scan over the input
    while (true) {
      // Read a byte
      if (i >= mappings.length)
        decodeError('Unexpected early end of mapping data');
      const c = mappings.charCodeAt(i);
      if ((c & 0x7f) !== c)
        decodeError(
          `Invalid mapping character: ${JSON.stringify(
            String.fromCharCode(c),
          )}`,
        );
      const index = vlqTable[c & 0x7f];
      if (index === 0xff)
        decodeError(
          `Invalid mapping character: ${JSON.stringify(
            String.fromCharCode(c),
          )}`,
        );
      i++;

      // Decode the byte
      vlq |= (index & 31) << shift;
      shift += 5;

      // Stop if there's no continuation bit
      if ((index & 32) === 0) break;
    }

    // Recover the signed value
    return vlq & 1 ? -(vlq >> 1) : vlq >> 1;
  }

  while (i < n) {
    let c = mappings.charCodeAt(i);

    // Handle a line break
    if (c === 59 /* ; */) {
      // The generated columns are very rarely out of order. In that case,
      // sort them with insertion since they are very likely almost ordered.
      if (needToSortGeneratedColumns) {
        for (let j = generatedLineStart + 6; j < dataLength; j += 6) {
          const genL = data[j];
          const genC = data[j + 1];
          const origS = data[j + 2];
          const origL = data[j + 3];
          const origC = data[j + 4];
          const origN = data[j + 5];
          let k = j - 6;
          for (; k >= generatedLineStart && data[k + 1] > genC; k -= 6) {
            data[k + 6] = data[k];
            data[k + 7] = data[k + 1];
            data[k + 8] = data[k + 2];
            data[k + 9] = data[k + 3];
            data[k + 10] = data[k + 4];
            data[k + 11] = data[k + 5];
          }
          data[k + 6] = genL;
          data[k + 7] = genC;
          data[k + 8] = origS;
          data[k + 9] = origL;
          data[k + 10] = origC;
          data[k + 11] = origN;
        }
      }

      generatedLine++;
      generatedColumn = 0;
      generatedLineStart = dataLength;
      needToSortGeneratedColumns = false;
      i++;
      continue;
    }

    // Ignore stray commas
    if (c === 44 /* , */) {
      i++;
      continue;
    }

    // Read the generated column
    const generatedColumnDelta = decodeVLQ();
    if (generatedColumnDelta < 0) needToSortGeneratedColumns = true;
    generatedColumn += generatedColumnDelta;
    if (generatedColumn < 0)
      decodeError(`Invalid generated column: ${generatedColumn}`);

    // It's valid for a mapping to have 1, 4, or 5 variable-length fields
    let isOriginalSourceMissing = true;
    let isOriginalNameMissing = true;
    if (i < n) {
      c = mappings.charCodeAt(i);
      if (c === 44 /* , */) {
        i++;
      } else if (c !== 59 /* ; */) {
        isOriginalSourceMissing = false;

        // Read the original source
        const originalSourceDelta = decodeVLQ();
        originalSource += originalSourceDelta;
        if (originalSource < 0 || originalSource >= sourcesCount)
          decodeError(
            `Original source index ${originalSource} is invalid (there are ${sourcesCount} sources)`,
          );

        // Read the original line
        const originalLineDelta = decodeVLQ();
        originalLine += originalLineDelta;
        if (originalLine < 0)
          decodeError(`Invalid original line: ${originalLine}`);

        // Read the original column
        const originalColumnDelta = decodeVLQ();
        originalColumn += originalColumnDelta;
        if (originalColumn < 0)
          decodeError(`Invalid original column: ${originalColumn}`);

        // Check for the optional name index
        if (i < n) {
          c = mappings.charCodeAt(i);
          if (c === 44 /* , */) {
            i++;
          } else if (c !== 59 /* ; */) {
            isOriginalNameMissing = false;

            // Read the optional name index
            const originalNameDelta = decodeVLQ();
            originalName += originalNameDelta;
            if (originalName < 0 || originalName >= namesCount)
              decodeError(
                `Original name index ${originalName} is invalid (there are ${namesCount} names)`,
              );

            // Handle the next character
            if (i < n) {
              c = mappings.charCodeAt(i);
              if (c === 44 /* , */) {
                i++;
              } else if (c !== 59 /* ; */) {
                decodeError(
                  `Invalid character after mapping: ${JSON.stringify(
                    String.fromCharCode(c),
                  )}`,
                );
              }
            }
          }
        }
      }
    }

    // Append the mapping to the typed array
    if (dataLength + 6 > data.length) {
      const newData = new Int32Array(data.length << 1);
      newData.set(data);
      data = newData;
    }
    data[dataLength] = generatedLine;
    data[dataLength + 1] = generatedColumn;
    if (isOriginalSourceMissing) {
      data[dataLength + 2] = -1;
      data[dataLength + 3] = -1;
      data[dataLength + 4] = -1;
    } else {
      data[dataLength + 2] = originalSource;
      data[dataLength + 3] = originalLine;
      data[dataLength + 4] = originalColumn;
    }
    data[dataLength + 5] = isOriginalNameMissing ? -1 : originalName;
    dataLength += 6;
  }

  return data.subarray(0, dataLength);
}

interface Source {
  name: string;
  content: string;
  data: Int32Array;
  dataLength: number;
}

function generateInverseMappings(sources: Source[], data: Int32Array) {
  let longestDataLength = 0;

  // Scatter the mappings to the individual sources
  for (let i = 0, n = data.length; i < n; i += 6) {
    const originalSource = data[i + 2];
    if (originalSource === -1) continue;

    const source = sources[originalSource];
    let inverseData = source.data;
    let j = source.dataLength;

    // Append the mapping to the typed array
    if (j + 6 > inverseData.length) {
      const newLength = inverseData.length << 1;
      const newData = new Int32Array(newLength > 1024 ? newLength : 1024);
      newData.set(inverseData);
      source.data = inverseData = newData;
    }
    inverseData[j] = data[i];
    inverseData[j + 1] = data[i + 1];
    inverseData[j + 2] = originalSource;
    inverseData[j + 3] = data[i + 3];
    inverseData[j + 4] = data[i + 4];
    inverseData[j + 5] = data[i + 5];
    j += 6;
    source.dataLength = j;
    if (j > longestDataLength) longestDataLength = j;
  }

  // Sort the mappings for each individual source
  const temp = new Int32Array(longestDataLength);
  for (const source of sources) {
    const data = source.data.subarray(0, source.dataLength);

    // Sort lazily for performance
    let isSorted = false;
    Object.defineProperty(source, 'data', {
      get() {
        if (!isSorted) {
          temp.set(data);
          topDownSplitMerge(temp, 0, data.length, data);
          isSorted = true;
        }
        return data;
      },
    });
  }

  // From: https://en.wikipedia.org/wiki/Merge_sort
  function topDownSplitMerge(
    B: Int32Array,
    iBegin: number,
    iEnd: number,
    A: Int32Array,
  ) {
    if (iEnd - iBegin <= 6) return;

    // Optimization: Don't do merge sort if it's already sorted
    let isAlreadySorted = true;
    for (let i = iBegin + 3, j = i + 6; j < iEnd; i = j, j += 6) {
      // Compare mappings first by original line (index 3) and then by original column (index 4)
      if (A[i] < A[j] || (A[i] === A[j] && A[i + 1] <= A[j + 1])) continue;
      isAlreadySorted = false;
      break;
    }
    if (isAlreadySorted) {
      return;
    }

    const iMiddle = ((iEnd / 6 + iBegin / 6) >> 1) * 6;
    topDownSplitMerge(A, iBegin, iMiddle, B);
    topDownSplitMerge(A, iMiddle, iEnd, B);
    topDownMerge(B, iBegin, iMiddle, iEnd, A);
  }

  // From: https://en.wikipedia.org/wiki/Merge_sort
  function topDownMerge(
    A: Int32Array,
    iBegin: number,
    iMiddle: number,
    iEnd: number,
    B: Int32Array,
  ) {
    let i = iBegin,
      j = iMiddle;
    for (let k = iBegin; k < iEnd; k += 6) {
      if (
        i < iMiddle &&
        (j >= iEnd ||
          // Compare mappings first by original line (index 3) and then by original column (index 4)
          A[i + 3] < A[j + 3] ||
          (A[i + 3] === A[j + 3] && A[i + 4] <= A[j + 4]))
      ) {
        B[k] = A[i];
        B[k + 1] = A[i + 1];
        B[k + 2] = A[i + 2];
        B[k + 3] = A[i + 3];
        B[k + 4] = A[i + 4];
        B[k + 5] = A[i + 5];
        i += 6;
      } else {
        B[k] = A[j];
        B[k + 1] = A[j + 1];
        B[k + 2] = A[j + 2];
        B[k + 3] = A[j + 3];
        B[k + 4] = A[j + 4];
        B[k + 5] = A[j + 5];
        j += 6;
      }
    }
  }
}

function parseSourceMap(raw: string) {
  let json: RawIndexMap | RawSourceMap;
  try {
    json = JSON.parse(raw);
    assert(json instanceof Object);
    assert(!(json instanceof Array));
  } catch (e) {
    assert(e instanceof Error);
    showLoadingError(
      `The imported source map contains invalid JSON data: ${(e && e.message) || e
      }`,
    );
    throw e;
  }

  if (json.version !== 3) {
    showLoadingError(
      `The imported source map is invalid. Expected the "version" field to contain the number 3.`,
    );
    throw new Error('Invalid source map');
  }

  if ('sections' in json && json.sections instanceof Array) {
    const sections = json.sections;
    const decodedSections = [];
    let totalDataLength = 0;

    for (let i = 0; i < sections.length; i++) {
      const {
        offset: { line, column },
        map,
      } = sections[i];
      if (typeof line !== 'number' || typeof column !== 'number') {
        showLoadingError(
          `The imported source map is invalid. Expected the "offset" field for section ${i} to have a line and column.`,
        );
        throw new Error('Invalid source map');
      }

      if (!map) {
        showLoadingError(
          `The imported source map is unsupported. Section ${i} does not contain a "map" field.`,
        );
        throw new Error('Invalid source map');
      }

      if (map.version !== 3) {
        showLoadingError(
          `The imported source map is invalid. Expected the "version" field for section ${i} to contain the number 3.`,
        );
        throw new Error('Invalid source map');
      }

      if (
        !(map.sources instanceof Array) ||
        map.sources.some(x => typeof x !== 'string')
      ) {
        showLoadingError(
          `The imported source map is invalid. Expected the "sources" field for section ${i} to be an array of strings.`,
        );
        throw new Error('Invalid source map');
      }

      if (typeof map.mappings !== 'string') {
        showLoadingError(
          `The imported source map is invalid. Expected the "mappings" field for section ${i} to be a string.`,
        );
        throw new Error('Invalid source map');
      }

      const { sourcesContent, names, mappings } = map;
      let sources: Source[] = [];
      const emptyData = new Int32Array(0);
      for (let i = 0; i < map.sources.length; i++) {
        sources[i] = {
          name: map.sources[i],
          content: (sourcesContent && sourcesContent[i]) || '',
          data: emptyData,
          dataLength: 0,
        };
      }

      const data = decodeMappings(
        mappings,
        sources.length,
        names ? names.length : 0,
      );
      decodedSections.push({ offset: { line, column }, sources, names, data });
      totalDataLength += data.length;
    }

    decodedSections.sort((a, b) => {
      if (a.offset.line < b.offset.line) return -1;
      if (a.offset.line > b.offset.line) return 1;
      if (a.offset.column < b.offset.column) return -1;
      if (a.offset.column > b.offset.column) return 1;
      return 0;
    });

    const mergedData = new Int32Array(totalDataLength);
    const mergedSources = [];
    const mergedNames = [];
    let dataOffset = 0;

    for (const {
      offset: { line, column },
      sources,
      names,
      data,
    } of decodedSections) {
      const sourcesOffset = mergedSources.length;
      const nameOffset = mergedNames.length;

      for (let i = 0, n = data.length; i < n; i += 6) {
        if (data[i] === 0) data[i + 1] += column;
        data[i] += line;
        if (data[i + 2] !== -1) data[i + 2] += sourcesOffset;
        if (data[i + 5] !== -1) data[i + 5] += nameOffset;
      }

      mergedData.set(data, dataOffset);
      for (const source of sources) mergedSources.push(source);
      if (names) for (const name of names) mergedNames.push(name);
      dataOffset += data.length;
    }

    generateInverseMappings(mergedSources, mergedData);
    return {
      sources: mergedSources,
      names: mergedNames,
      data: mergedData,
    };
  }

  if (
    !('sources' in json) ||
    !(json.sources instanceof Array) ||
    json.sources.some(x => typeof x !== 'string')
  ) {
    showLoadingError(
      `The imported source map is invalid. Expected the "sources" field to be an array of strings.`,
    );
    throw new Error('Invalid source map');
  }

  if (typeof json.mappings !== 'string') {
    showLoadingError(
      `The imported source map is invalid. Expected the "mappings" field to be a string.`,
    );
    throw new Error('Invalid source map');
  }

  const { sourcesContent, names, mappings } = json;
  let sources: Source[] = [];
  const emptyData = new Int32Array(0);
  for (let i = 0; i < json.sources.length; i++) {
    sources[i] = {
      name: json.sources[i],
      content: (sourcesContent && sourcesContent[i]) || '',
      data: emptyData,
      dataLength: 0,
    };
  }

  const data = decodeMappings(
    mappings,
    sources.length,
    names ? names.length : 0,
  );
  generateInverseMappings(sources, data);
  return { sources, names, data };
}

const toolbarHeight = 32;
const statusBarHeight = 32;

function waitForDOM() {
  return new Promise<void>(r => setTimeout(r, 1));
}

async function finishLoading(code: string, map: string) {
  const startTime = Date.now();
  promptText.style.display = 'none';
  toolbar.style.display = 'flex';
  statusBar.style.display = 'flex';
  canvas.style.display = 'block';
  originalStatus.textContent = generatedStatus.textContent = '';
  fileList.innerHTML = '';
  const option = document.createElement('option');
  option.textContent = `Loading...`;
  fileList.appendChild(option);
  fileList.disabled = true;
  fileList.selectedIndex = 0;
  originalTextArea = generatedTextArea = hover = null;
  isInvalid = true;
  updateHash(code, map);

  // Let the browser update before parsing the source map, which may be slow
  await waitForDOM();
  const sm = parseSourceMap(map);

  // Show a progress bar if this is is going to take a while
  let charsSoFar = 0;
  let progressCalls = 0;
  let isProgressVisible = false;
  const progressStart = Date.now();
  const totalChars =
    code.length + (sm.sources.length > 0 ? sm.sources[0].content.length : 0);
  const progress = (chars: number) => {
    charsSoFar += chars;
    if (!isProgressVisible && progressCalls++ > 2 && charsSoFar) {
      const estimatedTimeLeftMS =
        ((Date.now() - progressStart) / charsSoFar) * (totalChars - charsSoFar);
      if (estimatedTimeLeftMS > 250) {
        progressBarOverlay.style.display = 'block';
        isProgressVisible = true;
      }
    }
    if (isProgressVisible) {
      progressBar.style.transform = `scaleX(${charsSoFar / totalChars})`;
      return waitForDOM();
    }
  };
  progressBar.style.transform = `scaleX(0)`;

  // Update the original text area when the source changes
  const otherSource = (index: number) =>
    index === -1 ? null : sm.sources[index].name;
  const originalName = (index: number) => sm.names[index];
  let finalOriginalTextArea = null;
  if (sm.sources.length > 0) {
    const updateOriginalSource = (
      sourceIndex: number,
      progress?: ProgressCallback,
    ) => {
      const source = sm.sources[sourceIndex];
      return createTextArea({
        sourceIndex,
        text: source.content,
        progress,
        mappings: source.data,
        mappingsOffset: 3,
        otherSource,
        originalName,
        bounds() {
          return {
            x: 0,
            y: toolbarHeight,
            width: (innerWidth >>> 1) - (splitterWidth >> 1),
            height: innerHeight - toolbarHeight - statusBarHeight,
          };
        },
      });
    };
    fileList.onchange = async () => {
      originalTextArea = await updateOriginalSource(fileList.selectedIndex);
      isInvalid = true;
    };
    finalOriginalTextArea = await updateOriginalSource(0, progress);
  }

  generatedTextArea = await createTextArea({
    sourceIndex: null,
    text: code,
    progress,
    mappings: sm.data,
    mappingsOffset: 0,
    otherSource,
    originalName,
    bounds() {
      const x = (innerWidth >> 1) + ((splitterWidth + 1) >> 1);
      return {
        x,
        y: toolbarHeight,
        width: innerWidth - x,
        height: innerHeight - toolbarHeight - statusBarHeight,
      };
    },
  });

  // Only render the original text area once the generated text area is ready
  originalTextArea = finalOriginalTextArea;
  isInvalid = true;

  // Populate the file picker once there will be no more await points
  fileList.innerHTML = '';
  if (sm.sources.length > 0) {
    for (let sources = sm.sources, i = 0, n = sources.length; i < n; i++) {
      const option = document.createElement('option');
      option.textContent = `${i}: ${sources[i].name}`;
      fileList.appendChild(option);
    }
    fileList.disabled = false;
  } else {
    const option = document.createElement('option');
    option.textContent = `(no original code)`;
    fileList.appendChild(option);
  }
  fileList.selectedIndex = 0;

  if (isProgressVisible) progressBarOverlay.style.display = 'none';
  const endTime = Date.now();
  console.log(`Finished loading in ${endTime - startTime}ms`);
}

////////////////////////////////////////////////////////////////////////////////
// Drawing
interface Mapping {
  generatedLine: number;
  generatedColumn: number;
  originalSource: number;
  originalLine: number;
  originalColumn: number;
  originalName: number;
}
interface Hover {
  sourceIndex: number | null;
  lineIndex: number;
  row: number;
  column: number;
  index: number;
  mapping?: Mapping;
}
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
type ProgressCallback = (chars: number) => Promisable<void>;
interface TextArea {
  sourceIndex: number | null;
  updateAfterWrapChange(): void;
  getHoverRect(): [x: number, y: number, w: number, h: number] | null;
  bounds(): Bounds;
  draw(bodyStyle: CSSStyleDeclaration): void;
  scrollTo(column: number, line: number): void;
  onmousemove(e: MouseEvent): void;
  onmousedown(e: MouseEvent): void;
  onwheel(e: WheelEvent): void;
}

const originalLineColors = [
  'rgba(25, 133, 255, 0.3)', // Blue
  'rgba(174, 97, 174, 0.3)', // Purple
  'rgba(255, 97, 106, 0.3)', // Red
  'rgba(250, 192, 61, 0.3)', // Yellow
  'rgba(115, 192, 88, 0.3)', // Green
];

// Use a striped pattern for bad mappings (good mappings are solid)
const patternContours = [
  [0, 24, 24, 0, 12, 0, 0, 12, 0, 24],
  [0, 28, 28, 0, 40, 0, 0, 40, 0, 28],
  [0, 44, 44, 0, 56, 0, 0, 56, 0, 44],
  [12, 64, 24, 64, 64, 24, 64, 12, 12, 64],
  [0, 60, 0, 64, 8, 64, 64, 8, 64, 0, 60, 0, 0, 60],
  [28, 64, 40, 64, 64, 40, 64, 28, 28, 64],
  [0, 8, 8, 0, 0, 0, 0, 8],
  [44, 64, 56, 64, 64, 56, 64, 44, 44, 64],
  [64, 64, 64, 60, 60, 64, 64, 64],
];
const badMappingPatterns = originalLineColors.map(color => {
  let patternCanvas = document.createElement('canvas');
  let patternContext = patternCanvas.getContext('2d');
  assert(patternContext);
  let ratio: number, scale: number, pattern: CanvasPattern;
  return (dx: number, dy: number) => {
    if (devicePixelRatio !== ratio) {
      ratio = devicePixelRatio;
      scale = Math.round(64 * ratio) / 64;
      patternCanvas.width = patternCanvas.height = Math.round(64 * scale);
      patternContext.scale(scale, scale);
      patternContext.beginPath();
      for (const contour of patternContours) {
        for (let i = 0; i < contour.length; i += 2) {
          if (i === 0) patternContext.moveTo(contour[i], contour[i + 1]);
          else patternContext.lineTo(contour[i], contour[i + 1]);
        }
      }
      patternContext.fillStyle = color.replace(' 0.3)', ' 0.2)');
      patternContext.fill();
      pattern = $assert(c.createPattern(patternCanvas, 'repeat'));
    }
    pattern.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, dx, dy]));
    return pattern;
  };
});

const canvas = document.createElement('canvas');
const c = $assert(canvas.getContext('2d'));
const monospaceFont = '14px monospace';
const rowHeight = 21;
const splitterWidth = 6;
const margin = 64;
let isInvalid = true;
let originalTextArea: TextArea | null = null;
let generatedTextArea: TextArea | null = null;
let hover: Hover | null = null;
let highlighted: Record<
  'sourceIndex' | 'startIndex' | 'startColumn' | 'endIndex' | 'endColumn',
  number
> | null = {
  sourceIndex: 0,
  startIndex: 5,
  startColumn: 5,
  endIndex: 7,
  endColumn: 11,
};

const wrapCheckbox = $('input#wrap');
let wrap = true;
try {
  wrap = localStorage.getItem('wrap') !== 'false';
} catch (e) { }
wrapCheckbox.checked = wrap;
wrapCheckbox.onchange = () => {
  wrap = wrapCheckbox.checked;
  try {
    localStorage.setItem('wrap', String(wrap));
  } catch (e) { }
  if (originalTextArea) originalTextArea.updateAfterWrapChange();
  if (generatedTextArea) generatedTextArea.updateAfterWrapChange();
  isInvalid = true;
};

interface Line {
  raw: string;
  runBase: number;
  runCount: number;
  runText: Record<number, string>;
  endIndex: number;
  endColumn: number;
}

async function splitTextIntoLinesAndRuns(
  text: string,
  progress?: ProgressCallback,
) {
  c.font = monospaceFont;
  const spaceWidth = c.measureText(' ').width;
  const spacesPerTab = 2;
  const parts = text.split(/(\r\n|\r|\n)/g);
  const unicodeWidthCache = new Map();
  const lines: Line[] = [];
  const progressChunkSize = 1 << 20;
  let longestColumnForLine = new Int32Array(1024);
  let runData = new Int32Array(1024);
  let runDataLength = 0;
  let prevProgressPoint = 0;
  let longestLineInColumns = 0;
  let lineStartOffset = 0;

  for (let part = 0; part < parts.length; part++) {
    let raw = parts[part];
    if (part & 1) {
      // Accumulate the length of the newline (CRLF uses two code units)
      lineStartOffset += raw.length;
      continue;
    }

    const runBase = runDataLength;
    const n = raw.length + 1; // Add 1 for the extra character at the end
    let nextProgressPoint = progress
      ? prevProgressPoint + progressChunkSize - lineStartOffset
      : Infinity;
    let i = 0;
    let column = 0;

    while (i < n) {
      let startIndex = i;
      let startColumn = column;
      let whitespace = 0;
      let isSingleChunk = false;

      // Update the progress bar occasionally
      if (i > nextProgressPoint) {
        assert(progress);
        await progress(lineStartOffset + i - prevProgressPoint);
        prevProgressPoint = lineStartOffset + i;
        nextProgressPoint = i + progressChunkSize;
      }

      while (i < n) {
        let c1 = raw.charCodeAt(i);
        let c2;

        // Draw each tab into its own run
        if (c1 === 0x09 /* tab */) {
          if (i > startIndex) break;
          isSingleChunk = true;
          column += spacesPerTab;
          column -= column % spacesPerTab;
          i++;
          whitespace = c1;
          break;
        }

        // Draw each newline into its own run
        if (c1 !== c1 /* end of line */) {
          if (i > startIndex) break;
          isSingleChunk = true;
          column++;
          i++;
          whitespace = 0x0a /* newline */;
          break;
        }

        // Draw each non-ASCII character into its own run (e.g. emoji)
        if (c1 < 0x20 || c1 > 0x7e) {
          if (i > startIndex) break;
          isSingleChunk = true;
          i++;

          // Consume another code unit if this code unit is a high surrogate
          // and the next code point is a low surrogate. This handles code
          // points that span two UTF-16 code units.
          if (
            i < n &&
            c1 >= 0xd800 &&
            c1 <= 0xdbff &&
            (c2 = raw.charCodeAt(i)) >= 0xdc00 &&
            c2 <= 0xdfff
          ) {
            i++;
          }

          // This contains some logic to handle more complex emoji such as "👯‍♂️"
          // which is [U+1F46F, U+200D, U+2642, U+FE0F].
          while (i < n) {
            c1 = raw.charCodeAt(i);

            // Consume another code unit if the next code point is a variation selector
            if ((c1 & ~0xf) === 0xfe00) {
              i++;
            }

            // Consume another code unit if the next code point is a skin tone modifier
            else if (
              c1 === 0xd83c &&
              i + 1 < n &&
              (c2 = raw.charCodeAt(i + 1)) >= 0xdffb &&
              c2 <= 0xdfff
            ) {
              i += 2;
            }

            // Consume another code unit and stop if the next code point is a zero-width non-joiner
            else if (c1 === 0x200c) {
              i++;
              break;
            }

            // Consume another code unit if the next code point is a zero-width joiner
            else if (c1 === 0x200d) {
              i++;

              // Consume the next code point that is "joined" to this one
              if (i < n) {
                c1 = raw.charCodeAt(i);
                i++;
                if (
                  c1 >= 0xd800 &&
                  c1 <= 0xdbff &&
                  i < n &&
                  (c2 = raw.charCodeAt(i)) >= 0xdc00 &&
                  c2 <= 0xdfff
                ) {
                  i++;
                }
              }
            } else {
              break;
            }
          }

          const key = raw.slice(startIndex, i);
          let width = unicodeWidthCache.get(key);
          if (width === void 0) {
            width = Math.round(c.measureText(key).width / spaceWidth);
            if (width < 1) width = 1;
            unicodeWidthCache.set(key, width);
          }
          column += width;
          break;
        }

        // Draw runs of spaces in their own run
        if (c1 === 0x20 /* space */) {
          if (i === startIndex) whitespace = c1;
          else if (!whitespace) break;
        } else {
          if (whitespace) break;
        }

        column++;
        i++;
      }

      // Append the run to the typed array
      if (runDataLength + 5 > runData.length) {
        const newData = new Int32Array(runData.length << 1);
        newData.set(runData);
        runData = newData;
      }
      runData[runDataLength] =
        whitespace | (isSingleChunk ? 0x100 /* isSingleChunk */ : 0);
      runData[runDataLength + 1] = startIndex;
      runData[runDataLength + 2] = i;
      runData[runDataLength + 3] = startColumn;
      runData[runDataLength + 4] = column;
      runDataLength += 5;
    }

    const lineIndex = lines.length;
    if (lineIndex >= longestColumnForLine.length) {
      const newData = new Int32Array(longestColumnForLine.length << 1);
      newData.set(longestColumnForLine);
      longestColumnForLine = newData;
    }
    longestColumnForLine[lineIndex] = column;

    const runCount = (runDataLength - runBase) / 5;
    lines.push({
      raw,
      runBase,
      runCount,
      runText: {},
      endIndex: i,
      endColumn: column,
    });
    longestLineInColumns = Math.max(longestLineInColumns, column);
    lineStartOffset += raw.length;
  }

  if (prevProgressPoint < text.length && progress) {
    await progress(text.length - prevProgressPoint);
  }

  return {
    lines,
    longestColumnForLine,
    longestLineInColumns,
    runData: runData.subarray(0, runDataLength),
  };
}

interface CreateTextAreaParams {
  sourceIndex: number | null;
  text: string;
  progress?: ProgressCallback;
  mappings: Int32Array;
  mappingsOffset: number;
  otherSource: (index: number) => string | null;
  originalName: (index: number) => string;
  bounds: () => Bounds;
}

async function createTextArea({
  sourceIndex,
  text,
  progress,
  mappings,
  mappingsOffset,
  otherSource,
  originalName,
  bounds,
}: CreateTextAreaParams): Promise<TextArea> {
  const shadowWidth = 16;
  const textPaddingX = 5;
  const textPaddingY = 1;
  const scrollbarThickness = 16;
  const hoverBoxLineThickness = 2;

  // Runs are stored in a flat typed array to improve loading time
  const run_whitespace = (index: number) => runData[index] & 0xff;
  const run_isSingleChunk = (index: number) => runData[index] & 0x100;
  const run_startIndex = (index: number) => runData[index + 1];
  const run_endIndex = (index: number) => runData[index + 2];
  const run_startColumn = (index: number) => runData[index + 3];
  const run_endColumn = (index: number) => runData[index + 4];

  let { lines, longestColumnForLine, longestLineInColumns, runData } =
    await splitTextIntoLinesAndRuns(text, progress);
  let animate: (() => void) | null = null;
  let lastLineIndex = lines.length - 1;
  let scrollX = 0;
  let scrollY = 0;

  // Source mappings may lie outside of the source code. This happens both
  // when the source code is missing or when the source mappings are buggy.
  // In these cases, we should extend the scroll area to allow the user to
  // view these out-of-bounds source mappings.
  for (let i = 0, n = mappings.length; i < n; i += 6) {
    let line = mappings[i + mappingsOffset];
    let column = mappings[i + mappingsOffset + 1];
    if (line < lines.length) {
      const { endIndex, endColumn } = lines[line];

      // Take into account tabs tops and surrogate pairs
      if (endColumn > column) {
        column = endColumn;
      } else if (column > endColumn) {
        column = column - endIndex + endColumn;
      }
    } else if (line > lastLineIndex) {
      lastLineIndex = line;
    }
    if (column > longestLineInColumns) {
      longestLineInColumns = column;
    }
    if (line >= longestColumnForLine.length) {
      const newData = new Int32Array(longestColumnForLine.length << 1);
      newData.set(longestColumnForLine);
      longestColumnForLine = newData;
    }
    longestColumnForLine[line] = column;
  }

  const wrappedRowsCache = new Map<any, Int32Array>();

  function computeColumnsAcross(width: number, columnWidth: number) {
    if (!wrap) return Infinity;
    return Math.max(
      1,
      Math.floor(
        (width - margin - textPaddingX - scrollbarThickness) / columnWidth,
      ),
    );
  }

  function wrappedRowsForColumns(columnsAcross: number) {
    let result = wrappedRowsCache.get(columnsAcross);
    if (!result) {
      result = new Int32Array(lastLineIndex + 2);
      let rows = 0,
        n = lastLineIndex + 1;
      if (columnsAcross === Infinity) {
        for (let i = 0; i <= n; i++) {
          result[i] = i;
        }
      } else {
        for (let i = 0; i < n; i++) {
          result[i] = rows;
          rows += Math.ceil(longestColumnForLine[i] / columnsAcross) || 1;
        }
        result[n] = rows;
      }
      wrappedRowsCache.set(columnsAcross, result);
    }
    return result;
  }

  function computeScrollbarsAndClampScroll() {
    const { width, height } = bounds();
    c.font = '14px monospace';
    const columnWidth = c.measureText(' '.repeat(64)).width / 64;
    const columnsAcross = computeColumnsAcross(width, columnWidth);
    const wrappedRows = wrappedRowsForColumns(columnsAcross);

    let scrollbarX = null;
    let scrollbarY = null;
    let maxScrollX;
    let maxScrollY;

    if (wrap) {
      maxScrollX = 0;
      maxScrollY =
        (wrappedRowsForColumns(computeColumnsAcross(width, columnWidth))[
          lastLineIndex + 1
        ] -
          1) *
        rowHeight;
    } else {
      maxScrollX = Math.round(
        longestLineInColumns * columnWidth +
        textPaddingX * 2 +
        margin +
        scrollbarThickness -
        width,
      );
      maxScrollY = lastLineIndex * rowHeight;
    }

    scrollX = Math.max(0, Math.min(scrollX, maxScrollX));
    scrollY = Math.max(0, Math.min(scrollY, maxScrollY));

    if (maxScrollX > 0) {
      const trackLength = width - margin - scrollbarThickness / 2;
      scrollbarX = {
        trackLength,
        thumbLength: Math.max(
          scrollbarThickness * 2,
          trackLength / (1 + maxScrollX / trackLength),
        ),
      };
    }

    if (maxScrollY > 0) {
      const trackLength = height - scrollbarThickness / 2;
      scrollbarY = {
        trackLength,
        thumbLength: Math.max(
          scrollbarThickness * 2,
          trackLength / (1 + maxScrollY / trackLength),
        ),
      };
    }

    return {
      columnWidth,
      columnsAcross,
      wrappedRows,
      maxScrollX,
      maxScrollY,
      scrollbarX,
      scrollbarY,
    };
  }

  const emptyLine: Line = {
    raw: '',
    runCount: 0,
    runBase: NaN,
    runText: {},
    endColumn: NaN,
    endIndex: NaN,
  };

  function analyzeLine(
    line: number,
    column: number,
    fractionalColumn: number,
    tabStopBehavior: 'round' | 'floor',
  ) {
    let index = column;
    let firstRun = 0;
    let nearbyRun = 0;
    let { raw, runBase, runCount, runText } =
      line < lines.length ? lines[line] : emptyLine;
    let runLimit = runCount;
    let endOfLineIndex = 0;
    let endOfLineColumn = 0;
    let beforeNewlineIndex = 0;
    let hasTrailingNewline = false;

    if (runLimit > 0) {
      let lastRun = runBase + 5 * (runLimit - 1);
      endOfLineIndex = run_endIndex(lastRun);
      endOfLineColumn = run_endColumn(lastRun);
      beforeNewlineIndex = run_startIndex(lastRun);
      hasTrailingNewline = run_whitespace(lastRun) === 0x0a /* newline */;

      // Binary search to find the first run
      firstRun = 0;
      while (runLimit > 0) {
        let step = runLimit >> 1;
        let it = firstRun + step;
        if (run_endColumn(runBase + 5 * it) < column) {
          firstRun = it + 1;
          runLimit -= step + 1;
        } else {
          runLimit = step;
        }
      }

      // Use the last run if we're past the end of the line
      if (firstRun >= runCount) firstRun--;

      // Convert column to index
      nearbyRun = firstRun;
      while (run_startColumn(runBase + 5 * nearbyRun) > column && nearbyRun > 0)
        nearbyRun--;
      while (
        run_endColumn(runBase + 5 * nearbyRun) < column &&
        nearbyRun + 1 < runCount
      )
        nearbyRun++;
      let run = runBase + 5 * nearbyRun;
      if (run_isSingleChunk(run) && column <= run_endColumn(run)) {
        // A special case for single-character blocks such as tabs and emoji
        if (
          (tabStopBehavior === 'round' &&
            fractionalColumn >=
            (run_startColumn(run) + run_endColumn(run)) / 2) ||
          (tabStopBehavior === 'floor' &&
            fractionalColumn >= run_endColumn(run))
        ) {
          index = run_endIndex(run);
          column = run_endColumn(run);
        } else {
          index = run_startIndex(run);
          column = run_startColumn(run);
        }
      } else {
        index = run_startIndex(run) + column - run_startColumn(run);
      }
    }

    // Binary search to find the first mapping that is >= index
    let firstMapping = 0;
    let mappingCount = mappings.length;
    while (mappingCount > 0) {
      let step = ((mappingCount / 6) >> 1) * 6;
      let it = firstMapping + step;
      let mappingLine = mappings[it + mappingsOffset];
      if (
        mappingLine < line ||
        (mappingLine === line && mappings[it + mappingsOffset + 1] < index)
      ) {
        firstMapping = it + 6;
        mappingCount -= step + 6;
      } else {
        mappingCount = step;
      }
    }

    // Back up to the previous mapping if we're at the end of the line or the mapping we found is after us
    if (
      firstMapping > 0 &&
      mappings[firstMapping - 6 + mappingsOffset] === line &&
      (firstMapping >= mappings.length ||
        mappings[firstMapping + mappingsOffset] > line ||
        mappings[firstMapping + mappingsOffset + 1] > index)
    ) {
      firstMapping -= 6;
    }

    // Seek to the first of any duplicate mappings
    const current = mappings[firstMapping + mappingsOffset + 1];
    while (
      firstMapping > 0 &&
      mappings[firstMapping - 6 + mappingsOffset] === line &&
      mappings[firstMapping - 6 + mappingsOffset + 1] === current
    ) {
      firstMapping -= 6;
    }

    function columnToIndex(column: number) {
      // If there is no underlying line, just use one index per column
      let index = column;
      if (runCount > 0) {
        while (
          run_startColumn(runBase + 5 * nearbyRun) > column &&
          nearbyRun > 0
        )
          nearbyRun--;
        while (
          run_endColumn(runBase + 5 * nearbyRun) < column &&
          nearbyRun + 1 < runCount
        )
          nearbyRun++;
        let run = runBase + 5 * nearbyRun;
        index =
          column === run_endColumn(run)
            ? run_endIndex(run)
            : run_startIndex(run) + column - run_startColumn(run);
      }
      return index;
    }

    function indexToColumn(index: number) {
      // If there is no underlying line, just use one column per index
      let column = index;
      if (runCount > 0) {
        while (run_startIndex(runBase + 5 * nearbyRun) > index && nearbyRun > 0)
          nearbyRun--;
        while (
          run_endIndex(runBase + 5 * nearbyRun) < index &&
          nearbyRun + 1 < runCount
        )
          nearbyRun++;
        let run = runBase + 5 * nearbyRun;
        column =
          index === run_endIndex(run)
            ? run_endColumn(run)
            : run_startColumn(run) + index - run_startIndex(run);
      }
      return column;
    }

    function rangeOfMapping(map: number) {
      if (mappings[map + mappingsOffset] !== line) return null;
      let startIndex = mappings[map + mappingsOffset + 1];
      let endIndex =
        startIndex > endOfLineIndex
          ? startIndex
          : hasTrailingNewline && startIndex < beforeNewlineIndex
            ? beforeNewlineIndex
            : endOfLineIndex;
      let isLastMappingInLine = false;

      // Ignore subsequent duplicate mappings
      if (
        map > 0 &&
        mappings[map - 6 + mappingsOffset] === line &&
        mappings[map - 6 + mappingsOffset + 1] === startIndex
      ) {
        return null;
      }

      // Skip past any duplicate mappings after us so we can get to the next non-duplicate mapping
      while (
        map + 6 < mappings.length &&
        mappings[map + 6 + mappingsOffset] === line &&
        mappings[map + 6 + mappingsOffset + 1] === startIndex
      ) {
        map += 6;
      }

      // Extend this mapping up to the next mapping if it's on the same line
      if (
        map + 6 < mappings.length &&
        mappings[map + 6 + mappingsOffset] === line
      ) {
        endIndex = mappings[map + 6 + mappingsOffset + 1];
      } else if (endIndex === startIndex) {
        isLastMappingInLine = true;
      }

      return {
        startIndex,
        startColumn: indexToColumn(startIndex),
        endIndex,
        endColumn: indexToColumn(endIndex),
        isLastMappingInLine,
      };
    }

    return {
      raw,
      index,
      column,
      firstRun,
      runBase,
      runCount,
      runText,
      firstMapping,
      endOfLineIndex,
      endOfLineColumn,
      columnToIndex,
      indexToColumn,
      rangeOfMapping,
    };
  }

  // This returns the index of the line containing the provided row. This is
  // not a 1:1 mapping when line wrapping is enabled. The residual row count
  // (i.e. how many rows are there from the start of the line) can be found
  // with "row - wrappedRows[lineIndex]".
  function lineIndexForRow(wrappedRows: Int32Array, row: number) {
    let n = lastLineIndex + 1;
    if (row > wrappedRows[n]) {
      return n + row - wrappedRows[n];
    }
    let lineIndex = 0;
    while (n > 0) {
      let step = n >> 1;
      let it = lineIndex + step;
      if (wrappedRows[it + 1] <= row) {
        lineIndex = it + 1;
        n -= step + 1;
      } else {
        n = step;
      }
    }
    return lineIndex;
  }

  function boxForRange(
    dx: number,
    dy: number,
    columnWidth: number,
    { startColumn, endColumn }: { startColumn: number; endColumn: number },
  ): [x1: number, y1: number, x2: number, y2: number] {
    const x1 = Math.round(dx + startColumn * columnWidth + 1);
    const x2 = Math.round(
      dx +
      (startColumn === endColumn
        ? startColumn * columnWidth + 4
        : endColumn * columnWidth) -
      1,
    );
    const y1 = Math.round(dy + 2);
    const y2 = Math.round(dy + +rowHeight - 2);
    return [x1, y1, x2, y2];
  }

  const ret: TextArea = {
    sourceIndex,
    bounds,

    updateAfterWrapChange() {
      scrollX = 0;
      computeScrollbarsAndClampScroll();
    },

    getHoverRect() {
      assert(hover?.mapping);
      const lineIndex =
        sourceIndex === null
          ? hover.mapping.generatedLine
          : hover.mapping.originalLine;
      const index =
        sourceIndex === null
          ? hover.mapping.generatedColumn
          : hover.mapping.originalColumn;
      const column = analyzeLine(
        lineIndex,
        index,
        index,
        'floor',
      ).indexToColumn(index);
      const { firstMapping, rangeOfMapping } = analyzeLine(
        lineIndex,
        column,
        column,
        'floor',
      );
      const range = rangeOfMapping(firstMapping);
      if (!range) return null;
      const { x, y } = bounds();
      const { columnWidth, columnsAcross, wrappedRows } =
        computeScrollbarsAndClampScroll();

      // Compute the mouse row accounting for line wrapping
      const rowDelta = wrap ? Math.floor(column / columnsAcross) : 0;
      const row = wrappedRows[lineIndex] + rowDelta;
      const dx = x - scrollX + margin + textPaddingX;
      const dy = y - scrollY + textPaddingY + row * rowHeight;

      // Adjust the mouse column due to line wrapping
      let { startColumn, endColumn } = range;
      if (wrap) {
        const columnAdjustment = rowDelta * columnsAcross;
        startColumn -= columnAdjustment;
        endColumn -= columnAdjustment;
      }

      const [x1, y1, x2, y2] = boxForRange(dx, dy, columnWidth, {
        startColumn,
        endColumn,
      });
      return [x1, y1, x2 - x1, y2 - y1];
    },

    onwheel(e: WheelEvent) {
      let { x, y, width, height } = bounds();
      if (
        e.pageX >= x &&
        e.pageX < x + width &&
        e.pageY >= y &&
        e.pageY < y + height
      ) {
        scrollX = Math.round(scrollX + e.deltaX);
        scrollY = Math.round(scrollY + e.deltaY);
        computeScrollbarsAndClampScroll();
        isInvalid = true;
        this.onmousemove(e);
      }
    },

    onmousemove(e: MouseEvent) {
      const { x, y, width, height } = bounds();

      if (
        e.pageX >= x + margin &&
        e.pageX < x + width - scrollbarThickness &&
        e.pageY >= y &&
        e.pageY < y + height
      ) {
        const { columnWidth, columnsAcross, wrappedRows } =
          computeScrollbarsAndClampScroll();
        let fractionalColumn =
          (e.pageX - x - margin - textPaddingX + scrollX) / columnWidth;
        let roundedColumn = Math.round(fractionalColumn);

        if (roundedColumn >= 0) {
          const row = Math.floor(
            (e.pageY - y - textPaddingY + scrollY) / rowHeight,
          );

          if (row >= 0) {
            // Adjust the mouse column due to line wrapping
            const lineIndex = lineIndexForRow(wrappedRows, row);
            const firstColumn =
              wrap && lineIndex < wrappedRows.length
                ? (row - wrappedRows[lineIndex]) * columnsAcross
                : 0;
            const lastColumn = firstColumn + columnsAcross;
            fractionalColumn += firstColumn;
            roundedColumn += firstColumn;

            const flooredColumn = Math.floor(fractionalColumn);
            const { index: snappedRoundedIndex, column: snappedRoundedColumn } =
              analyzeLine(lineIndex, roundedColumn, fractionalColumn, 'round');
            const {
              index: snappedFlooredIndex,
              firstMapping,
              rangeOfMapping,
            } = analyzeLine(
              lineIndex,
              flooredColumn,
              fractionalColumn,
              'floor',
            );

            // Check to see if this nearest mapping is being hovered
            let mapping: Mapping | null = null;
            const range = rangeOfMapping(firstMapping);
            if (
              range !== null &&
              // If this is a zero-width mapping, hit-test with the caret
              ((range.isLastMappingInLine &&
                range.startIndex === snappedRoundedIndex) ||
                // Otherwise, determine the bounding-box and hit-test against that
                (snappedFlooredIndex >= range.startIndex &&
                  snappedFlooredIndex < range.endIndex &&
                  range.startColumn < lastColumn &&
                  range.endColumn > firstColumn))
            ) {
              mapping = {
                generatedLine: mappings[firstMapping],
                generatedColumn: mappings[firstMapping + 1],
                originalSource: mappings[firstMapping + 2],
                originalLine: mappings[firstMapping + 3],
                originalColumn: mappings[firstMapping + 4],
                originalName: mappings[firstMapping + 5],
              };
            }

            hover = {
              sourceIndex,
              lineIndex,
              row,
              column: snappedRoundedColumn,
              index: snappedRoundedIndex,
              mapping: mapping || undefined,
            };
          }
        }
      }
    },

    onmousedown(e: MouseEvent) {
      const { x, y, width, height } = bounds();
      const px = e.pageX - x;
      const py = e.pageY - y;
      if (px < 0 || py < 0 || px >= width || py >= height) return;
      const { maxScrollX, maxScrollY, scrollbarX, scrollbarY } =
        computeScrollbarsAndClampScroll();

      // Handle scrollbar dragging
      let mousemove;
      if (scrollbarX && py > height - scrollbarThickness) {
        let originalScrollX = scrollX;
        mousemove = (e: MouseEvent) => {
          scrollX = Math.round(
            originalScrollX +
            ((e.pageX - x - px) * maxScrollX) /
            (scrollbarX.trackLength - scrollbarX.thumbLength),
          );
          computeScrollbarsAndClampScroll();
          isInvalid = true;
        };
      } else if (scrollbarY && px > width - scrollbarThickness) {
        let originalScrollY = scrollY;
        mousemove = (e: MouseEvent) => {
          scrollY = Math.round(
            originalScrollY +
            ((e.pageY - y - py) * maxScrollY) /
            (scrollbarY.trackLength - scrollbarY.thumbLength),
          );
          computeScrollbarsAndClampScroll();
          isInvalid = true;
        };
      } else {
        // Scroll to the hover target on click
        if (hover && hover.mapping) {
          if (sourceIndex !== null) {
            assert(generatedTextArea);
            generatedTextArea.scrollTo(
              hover.mapping.generatedColumn,
              hover.mapping.generatedLine,
            );
          } else {
            assert(originalTextArea);
            if (originalTextArea.sourceIndex !== hover.mapping.originalSource) {
              fileList.selectedIndex = hover.mapping.originalSource;
              fileList.addEventListener(
                'change',
                () => {
                  assert(originalTextArea && hover?.mapping);
                  originalTextArea.scrollTo(
                    hover.mapping.originalColumn,
                    hover.mapping.originalLine,
                  );
                },
                { once: true },
              );
            } else {
              originalTextArea.scrollTo(
                hover.mapping.originalColumn,
                hover.mapping.originalLine,
              );
            }
          }
        }
        return;
      }

      let mouseup = () => {
        document.removeEventListener('mousemove', mousemove);
        document.removeEventListener('mouseup', mouseup);
      };
      document.addEventListener('mousemove', mousemove);
      document.addEventListener('mouseup', mouseup);
      e.preventDefault();
    },

    scrollTo(index: number, line: number) {
      const start = Date.now();
      const startX = scrollX;
      const startY = scrollY;
      const { width, height } = bounds();
      const { columnWidth, columnsAcross, wrappedRows } =
        computeScrollbarsAndClampScroll();
      const { indexToColumn } = analyzeLine(line, index, index, 'floor');
      const column = indexToColumn(index);
      const { firstMapping, rangeOfMapping } = analyzeLine(
        line,
        column,
        column,
        'floor',
      );
      const range = rangeOfMapping(firstMapping);
      const targetColumn = range
        ? range.startColumn +
        Math.min(
          (range.endColumn - range.startColumn) / 2,
          (width - margin) / 4 / columnWidth,
        )
        : column;
      const endX = Math.max(
        0,
        Math.round(targetColumn * columnWidth - (width - margin) / 2),
      );
      const row = wrap
        ? wrappedRows[line] + Math.floor(column / columnsAcross)
        : line;
      const endY = Math.max(
        0,
        Math.round((row + 0.5) * rowHeight - height / 2),
      );
      if (startX === endX && startY === endY) return;
      const duration = 250;
      animate = () => {
        isInvalid = true;
        const current = Date.now();
        let t = (current - start) / duration;
        if (t >= 1) {
          scrollX = endX;
          scrollY = endY;
          animate = null;
        } else {
          t *= t * (3 - 2 * t); // Use an ease-in-out curve
          scrollX = startX + (endX - startX) * t;
          scrollY = startY + (endY - startY) * t;
        }
      };
      animate();
    },

    draw(bodyStyle: CSSStyleDeclaration) {
      if (animate) animate();

      const drawRow = (
        dx: number,
        dy: number,
        lineIndex: number,
        firstColumn: number,
        lastColumn: number,
      ) => {
        const {
          raw,
          firstRun,
          runBase,
          runCount,
          runText,
          firstMapping,
          endOfLineColumn,
          rangeOfMapping,
          columnToIndex,
        } = analyzeLine(lineIndex, firstColumn, firstColumn, 'floor');
        const lastIndex = columnToIndex(lastColumn);

        // Don't draw any text if the whole line is offscreen
        if (firstRun < runCount) {
          // Scan to find the last run
          let lastRun = firstRun;
          while (
            lastRun + 1 < runCount &&
            run_startColumn(runBase + 5 * (lastRun + 1)) < lastColumn
          ) {
            lastRun++;
          }

          // Draw the runs
          const dyForText = dy + 0.7 * rowHeight;
          let currentColumn = firstColumn;
          for (let i = firstRun; i <= lastRun; i++) {
            const run = runBase + 5 * i;
            let startColumn = run_startColumn(run);
            let endColumn = run_endColumn(run);
            let whitespace = run_whitespace(run);
            let text = runText[i];

            // Lazily-generate text for runs to improve performance. When
            // this happens, the run text is the code unit offset of the
            // start of the line containing this run.
            if (text === void 0) {
              text = runText[i] = !whitespace
                ? raw.slice(run_startIndex(run), run_endIndex(run))
                : whitespace === 0x20 /* space */
                  ? '·'.repeat(run_endIndex(run) - run_startIndex(run))
                  : whitespace === 0x0a /* newline */
                    ? lineIndex === lines.length - 1
                      ? '∅'
                      : '↵'
                    : '→' /* tab */;
            }

            // Limit the run to the visible columns (but only for ASCII runs)
            if (!run_isSingleChunk(run)) {
              if (startColumn < currentColumn) {
                text = text.slice(currentColumn - startColumn);
                startColumn = currentColumn;
              }
              if (endColumn > lastColumn) {
                text = text.slice(0, lastColumn - startColumn);
                endColumn = lastColumn;
              }
            }

            // Draw whitespace in a separate batch
            (whitespace ? whitespaceBatch : textBatch).push(
              text,
              dx + startColumn * columnWidth,
              dyForText,
            );
            currentColumn = endColumn;
          }
        }

        // Draw the mappings
        for (let map = firstMapping; map < mappings.length; map += 6) {
          if (
            mappings[map + mappingsOffset] !== lineIndex ||
            mappings[map + mappingsOffset + 1] >= lastIndex
          )
            break;
          if (mappings[map + 2] === -1) continue;

          // Get the bounds of this mapping, which may be empty if it's ignored
          const range = rangeOfMapping(map);
          if (range === null) continue;
          const { startColumn, endColumn } = range;
          const color = mappings[map + 3] % originalLineColors.length;
          const [x1, y1, x2, y2] = boxForRange(dx, dy, columnWidth, range);

          // Check if this mapping is hovered
          let isHovered = false;
          if (hoveredMapping) {
            const isGenerated = sourceIndex === null;
            assert(hover);
            const hoverIsGenerated = hover.sourceIndex === null;
            const matchesGenerated =
              mappings[map] === hoveredMapping.generatedLine &&
              mappings[map + 1] === hoveredMapping.generatedColumn;
            const matchesOriginal =
              mappings[map + 2] === hoveredMapping.originalSource &&
              mappings[map + 3] === hoveredMapping.originalLine &&
              mappings[map + 4] === hoveredMapping.originalColumn;
            isHovered =
              hoveredMapping &&
              (isGenerated !== hoverIsGenerated
                ? // If this is on the opposite pane from the mouse, show all
                // mappings that match the hovered mapping instead of showing
                // an exact match.
                matchesGenerated || matchesOriginal
                : // If this is on the same pane as the mouse, only show the exact
                // mapping instead of showing everything that matches the target
                // so hovering isn't confusing.
                isGenerated
                  ? matchesGenerated
                  : matchesOriginal);
            if (
              isGenerated &&
              matchesGenerated &&
              hoveredMapping.originalName !== -1 &&
              !hoveredName
            ) {
              hoveredName = {
                text: originalName(hoveredMapping.originalName),
                x: Math.round(
                  dx + range.startColumn * columnWidth - hoverBoxLineThickness,
                ),
                y: Math.round(dy + 1.2 * rowHeight),
              };
            }
          }

          // Add a rectangle to that color's batch
          if (isHovered) {
            hoverBoxes.push({
              color,
              rect: [x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4],
            });
          } else if (
            lineIndex >= lines.length ||
            startColumn > endOfLineColumn
          ) {
            badMappingBatches[color].push(x1, y1, x2 - x1, y2 - y1);
          } else if (endColumn > endOfLineColumn) {
            let x12 = Math.round(
              x1 + (endOfLineColumn - startColumn) * columnWidth,
            );
            mappingBatches[color].push(x1, y1, x12 - x1, y2 - y1);
            badMappingBatches[color].push(x12, y1, x2 - x12, y2 - y1);
          } else {
            mappingBatches[color].push(x1, y1, x2 - x1, y2 - y1);
          }
        }
      };

      const { x, y, width, height } = bounds();
      const textColor = bodyStyle.color;
      const backgroundColor = bodyStyle.backgroundColor;
      const {
        columnWidth,
        columnsAcross,
        wrappedRows,
        maxScrollX,
        maxScrollY,
        scrollbarX,
        scrollbarY,
      } = computeScrollbarsAndClampScroll();

      // Compute the visible column/row rectangle
      const firstColumn = Math.max(
        0,
        Math.floor((scrollX - textPaddingX) / columnWidth),
      );
      const lastColumn = Math.max(
        0,
        Math.ceil(
          (scrollX -
            textPaddingX +
            width -
            margin -
            (wrap ? scrollbarThickness : 0)) /
          columnWidth,
        ),
      );
      const firstRow = Math.max(
        0,
        Math.floor((scrollY - textPaddingY) / rowHeight),
      );
      const lastRow = Math.max(
        0,
        Math.ceil((scrollY - textPaddingY + height) / rowHeight),
      );
      const firstLineIndex = lineIndexForRow(wrappedRows, firstRow);

      // Populate batches for the text
      interface HoverBox {
        rect: [x: number, y: number, width: number, height: number];
        color: number;
      }
      const hoverBoxes: HoverBox[] = [];
      const hoveredMapping = hover && hover.mapping;
      const mappingBatches: number[][] = [];
      const badMappingBatches: number[][] = [];
      const whitespaceBatch: (string | number)[] = [];
      const textBatch: (string | number)[] = [];
      let hoveredName = null as { text: string; x: number; y: number } | null;
      let lineIndex = firstLineIndex;
      let lineRow = wrappedRows[lineIndex];
      for (let i = 0; i < originalLineColors.length; i++) {
        mappingBatches.push([]);
        badMappingBatches.push([]);
      }
      for (let row = firstRow; row <= lastRow; row++) {
        const dx = x - scrollX + margin + textPaddingX;
        const dy = y - scrollY + textPaddingY + row * rowHeight;
        const columnAdjustment = wrap ? (row - lineRow) * columnsAcross : 0;
        drawRow(
          dx - columnAdjustment * columnWidth,
          dy,
          lineIndex,
          columnAdjustment + firstColumn,
          columnAdjustment + Math.max(firstColumn + 1, lastColumn - 1),
        );
        if (lineIndex + 1 >= wrappedRows.length) {
          lineIndex++;
          lineRow++;
        } else if (row + 1 >= wrappedRows[lineIndex + 1]) {
          lineIndex++;
          lineRow = wrappedRows[lineIndex];
        }
      }

      c.save();
      c.beginPath();
      c.rect(x, y, width, height);
      c.clip();

      // Flush batches for mappings
      for (let i = 0; i < mappingBatches.length; i++) {
        let batch = mappingBatches[i];
        if (batch.length > 0) {
          c.fillStyle = originalLineColors[i];
          for (let j = 0; j < batch.length; j += 4) {
            c.fillRect(batch[j], batch[j + 1], batch[j + 2], batch[j + 3]);
          }
        }
        batch = badMappingBatches[i];
        if (batch.length > 0) {
          c.fillStyle = badMappingPatterns[i](-scrollX, -scrollY);
          for (let j = 0; j < batch.length; j += 4) {
            c.fillRect(batch[j], batch[j + 1], batch[j + 2], batch[j + 3]);
          }
        }
      }

      let status = '';

      // Draw the hover box for all text areas
      if (hoverBoxes.length > 0) {
        // Draw the glows
        c.shadowBlur = 20;
        c.fillStyle = 'black';
        for (const {
          rect: [rx, ry, rw, rh],
          color,
        } of hoverBoxes) {
          c.shadowColor = originalLineColors[color].replace(' 0.3)', ' 1)');
          c.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
        }
        c.shadowColor = 'transparent';

        // Hollow out the boxes and draw a border around each one
        for (const {
          rect: [rx, ry, rw, rh],
        } of hoverBoxes) {
          c.clearRect(rx, ry, rw, rh);
        }
        c.strokeStyle = textColor;
        c.lineWidth = hoverBoxLineThickness;
        for (const {
          rect: [rx, ry, rw, rh],
        } of hoverBoxes) {
          c.strokeRect(rx, ry, rw, rh);
        }

        // Hollow out the boxes again. This is necessary to remove overlapping
        // borders from adjacent boxes due to duplicate mappings.
        for (const {
          rect: [rx, ry, rw, rh],
        } of hoverBoxes) {
          c.clearRect(rx + 2, ry + 1, rw - 4, rh - 2);
        }
      }
      // Draw the hover caret, but only for this text area
      else if (hover && hover.sourceIndex === sourceIndex) {
        const column =
          hover.column -
          (wrap && hover.lineIndex < wrappedRows.length
            ? columnsAcross * (hover.row - wrappedRows[hover.lineIndex])
            : 0);
        const caretX = Math.round(
          x - scrollX + margin + textPaddingX + column * columnWidth,
        );
        const caretY = Math.round(
          y - scrollY + textPaddingY + hover.row * rowHeight,
        );
        c.fillStyle = textColor;
        c.globalAlpha = 0.5;
        c.fillRect(caretX, caretY, 1, rowHeight);
        c.globalAlpha = 1;
        status = `Line ${hover.lineIndex + 1}, Offset ${hover.index}`;
      }
      // Split `highlighted` range into `highlightedBoxes` array.
      if (highlighted?.sourceIndex === this.sourceIndex) {
        const highlightedBoxes = [];
        for (let i = highlighted!.startIndex; i <= highlighted!.endIndex; i++) {
          const box = boxForRange(
            x - scrollX + margin + textPaddingX,
            y - scrollY + textPaddingY + rowHeight * i,
            columnWidth,
            {
              startColumn: i === highlighted!.startIndex ? highlighted!.startColumn : 0,
              endColumn: i === highlighted!.endIndex ? highlighted!.endColumn : columnsAcross,
            },
          );
          highlightedBoxes.push(box);
        }
        c.save();
        c.strokeStyle = 'red';
        c.lineWidth = 2;
        for (const box of highlightedBoxes) {
          c.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        }
        c.restore();
      }

      // Update the status bar
      if (hoveredMapping && hoveredMapping.originalColumn !== -1) {
        if (sourceIndex === null) {
          status = `Line ${hoveredMapping.generatedLine + 1}, Offset ${hoveredMapping.generatedColumn
            }`;
        } else {
          status = `Line ${hoveredMapping.originalLine + 1}, Offset ${hoveredMapping.originalColumn
            }`;
          if (hoveredMapping.originalSource !== sourceIndex) {
            status += ` in ${otherSource(hoveredMapping.originalSource)}`;
          }
        }
      }
      (sourceIndex === null ? generatedStatus : originalStatus).textContent =
        status;

      // Fade out wrapped mappings and hover boxes
      const wrapLeft = x + margin + textPaddingX;
      const wrapRight = wrapLeft + columnsAcross * columnWidth;
      if (wrap) {
        const transparentBackground = backgroundColor.replace(
          /^rgb\((\d+), (\d+), (\d+)\)$/,
          'rgba($1, $2, $3, 0)',
        );
        const leftFill = c.createLinearGradient(
          wrapLeft - textPaddingX,
          0,
          wrapLeft,
          0,
        );
        const rightFill = c.createLinearGradient(
          wrapRight + textPaddingX,
          0,
          wrapRight,
          0,
        );

        leftFill.addColorStop(0, backgroundColor);
        leftFill.addColorStop(1, transparentBackground);
        c.fillStyle = leftFill;
        c.fillRect(wrapLeft - textPaddingX, y, textPaddingX, height);

        rightFill.addColorStop(0, backgroundColor);
        rightFill.addColorStop(1, transparentBackground);
        c.fillStyle = rightFill;
        c.fillRect(wrapRight, y, x + width - wrapRight, height);
      }

      // Flush batches for the text, clipped to the wrap area (will cut emojis in half)
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      if (wrap) {
        c.save();
        c.beginPath();
        c.rect(wrapLeft, y, wrapRight - wrapLeft, height);
        c.clip();
      }
      if (whitespaceBatch.length > 0) {
        c.fillStyle = 'rgba(150, 150, 150, 0.4)';
        for (let j = 0; j < whitespaceBatch.length; j += 3) {
          c.fillText(
            whitespaceBatch[j] as string,
            whitespaceBatch[j + 1] as number,
            whitespaceBatch[j + 2] as number,
          );
        }
      }
      if (textBatch.length > 0) {
        c.fillStyle = textColor;
        for (let j = 0; j < textBatch.length; j += 3) {
          c.fillText(
            textBatch[j] as string,
            textBatch[j + 1] as number,
            textBatch[j + 2] as number,
          );
        }
      }
      if (wrap) {
        c.restore();
      }

      // Draw the original name tooltip
      if (hoveredName) {
        let { text, x: nameX, y: nameY } = hoveredName;
        const w = 2 * textPaddingX + c.measureText(text).width;
        const h = rowHeight;
        const r = 4;
        if (wrap) {
          // Clamp the tooltip in the viewport when wrapping is enabled
          nameX = Math.max(
            wrapLeft - hoverBoxLineThickness,
            Math.min(wrapRight - w + hoverBoxLineThickness, nameX),
          );
        }
        c.beginPath();
        c.arc(nameX + r, nameY + r, r, -Math.PI, -Math.PI / 2, false);
        c.arc(nameX + w - r, nameY + r, r, -Math.PI / 2, 0, false);
        c.arc(nameX + w - r, nameY + h - r, r, 0, Math.PI / 2, false);
        c.arc(nameX + r, nameY + h - r, r, Math.PI / 2, Math.PI, false);
        c.save();
        c.shadowColor = 'rgba(0, 0, 0, 0.5)';
        c.shadowOffsetY = 3;
        c.shadowBlur = 10;
        c.fillStyle = textColor;
        c.fill();
        c.restore();
        c.fillStyle = backgroundColor;
        c.fillText(text, nameX + textPaddingX, nameY + 0.7 * rowHeight);
      }

      // Draw the margin shadow
      if (scrollX > 0) {
        let gradient = c.createLinearGradient(
          x + margin,
          0,
          x + margin + shadowWidth,
          0,
        );
        for (let i = 0; i <= 10; i++) {
          let t = i / 10;
          gradient.addColorStop(t, `rgba(0, 0, 0, ${(1 - t) * (1 - t) * 0.2})`);
        }
        c.fillStyle = gradient;
        c.fillRect(x + margin, y, shadowWidth, height);
      }

      // Draw the scrollbars
      if (scrollbarX) {
        let dx =
          x +
          margin +
          (scrollX / maxScrollX) *
          (scrollbarX.trackLength - scrollbarX.thumbLength);
        let dy = y + height - scrollbarThickness;
        c.fillStyle = 'rgba(127, 127, 127, 0.5)';
        c.beginPath();
        c.arc(
          dx + scrollbarThickness / 2,
          dy + scrollbarThickness / 2,
          scrollbarThickness / 4,
          Math.PI / 2,
          (Math.PI * 3) / 2,
          false,
        );
        c.arc(
          dx + scrollbarX.thumbLength - scrollbarThickness / 2,
          dy + scrollbarThickness / 2,
          scrollbarThickness / 4,
          -Math.PI / 2,
          Math.PI / 2,
          false,
        );
        c.fill();
      }
      if (scrollbarY) {
        let dx = x + width - scrollbarThickness;
        let dy =
          y +
          (scrollY / maxScrollY) *
          (scrollbarY.trackLength - scrollbarY.thumbLength);
        c.fillStyle = 'rgba(127, 127, 127, 0.5)';
        c.beginPath();
        c.arc(
          dx + scrollbarThickness / 2,
          dy + scrollbarThickness / 2,
          scrollbarThickness / 4,
          -Math.PI,
          0,
          false,
        );
        c.arc(
          dx + scrollbarThickness / 2,
          dy + scrollbarY.thumbLength - scrollbarThickness / 2,
          scrollbarThickness / 4,
          0,
          Math.PI,
          false,
        );
        c.fill();
      }

      // Draw the margin
      c.fillStyle = backgroundColor;
      c.fillRect(x, y, margin, height);
      c.fillStyle = 'rgba(127, 127, 127, 0.1)';
      c.fillRect(x, y, margin, height);
      c.fillStyle = 'rgba(127, 127, 127, 0.5)';
      c.fillRect(x + margin - 1, y, 1, height);
      c.textAlign = 'right';
      c.fillStyle = textColor;
      c.font = '11px monospace';
      for (
        let i = firstLineIndex, n = wrappedRows.length;
        i <= lastLineIndex;
        i++
      ) {
        const row = i < n ? wrappedRows[i] : wrappedRows[n - 1] + (i - (n - 1));
        if (row > lastRow) break;
        const dx = x + margin - textPaddingX;
        const dy = y - scrollY + textPaddingY + (row + 0.6) * rowHeight;
        c.globalAlpha = i < lines.length ? 0.625 : 0.25;
        c.fillText((i + 1).toString(), dx, dy);
      }
      c.font = monospaceFont;
      c.globalAlpha = 1;

      c.restore();
    },
  };
  return ret;
}

function draw() {
  requestAnimationFrame(draw);
  if (!isInvalid) return;
  isInvalid = false;

  c.clearRect(0, 0, innerWidth, innerHeight);
  if (!generatedTextArea) return;

  const bodyStyle = getComputedStyle(document.body);
  if (originalTextArea) originalTextArea.draw(bodyStyle);
  generatedTextArea.draw(bodyStyle);

  // Draw the splitter
  c.fillStyle = 'rgba(127, 127, 127, 0.2)';
  c.fillRect(
    (innerWidth >>> 1) - (splitterWidth >> 1),
    toolbarHeight,
    splitterWidth,
    innerHeight - toolbarHeight - statusBarHeight,
  );

  // Draw the arrow between the two hover areas
  if (
    hover &&
    hover.mapping &&
    originalTextArea &&
    originalTextArea.sourceIndex === hover.mapping.originalSource
  ) {
    const originalHoverRect = originalTextArea.getHoverRect();
    const generatedHoverRect = generatedTextArea.getHoverRect();
    if (originalHoverRect && generatedHoverRect) {
      const textColor = bodyStyle.color;
      const originalBounds = originalTextArea.bounds();
      const generatedBounds = generatedTextArea.bounds();
      const originalArrowHead =
        hover.sourceIndex === generatedTextArea.sourceIndex;
      const generatedArrowHead =
        hover.sourceIndex === originalTextArea.sourceIndex;
      const [ox, oy, ow, oh] = originalHoverRect;
      const [gx, gy, , gh] = generatedHoverRect;
      const x1 =
        Math.min(ox + ow, originalBounds.x + originalBounds.width) +
        (originalArrowHead ? 10 : 2);
      const x2 =
        Math.max(gx, generatedBounds.x + margin) -
        (generatedArrowHead ? 10 : 2);
      const y1 = oy + oh / 2;
      const y2 = gy + gh / 2;

      c.save();
      c.beginPath();
      c.rect(
        0,
        toolbarHeight,
        innerWidth,
        innerHeight - toolbarHeight - statusBarHeight,
      );
      c.clip();

      // Draw the curve
      c.beginPath();
      c.moveTo(x1, y1);
      c.bezierCurveTo(
        (x1 + 2 * x2) / 3 + margin / 2,
        y1,
        (x1 * 2 + x2) / 3 - margin / 2,
        y2,
        x2,
        y2,
      );
      c.strokeStyle = textColor;
      c.lineWidth = 2;
      c.stroke();

      // Draw the arrow heads
      c.beginPath();
      if (originalArrowHead) {
        c.moveTo(x1 - 10, y1);
        c.lineTo(x1, y1 + 5);
        c.lineTo(x1, y1 - 5);
      }
      if (generatedArrowHead) {
        c.moveTo(x2 + 10, y2);
        c.lineTo(x2, y2 + 5);
        c.lineTo(x2, y2 - 5);
      }
      c.fillStyle = textColor;
      c.fill();

      c.restore();
    }
  }
}

document.onmousemove = e => {
  let oldHover = hover;
  hover = null;

  if (originalTextArea) originalTextArea.onmousemove(e);
  if (generatedTextArea) generatedTextArea.onmousemove(e);

  if (JSON.stringify(hover) !== JSON.stringify(oldHover)) {
    isInvalid = true;
  }
};

document.onmousedown = e => {
  if (originalTextArea) originalTextArea.onmousedown(e);
  if (generatedTextArea) generatedTextArea.onmousedown(e);
};

onblur = () => {
  if (hover) {
    hover = null;
    isInvalid = true;
  }
};

canvas.addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    if (originalTextArea) originalTextArea.onwheel(e);
    if (generatedTextArea) generatedTextArea.onwheel(e);
  },
  { passive: false },
);

const handleResize = () => {
  let width = innerWidth;
  let height = innerHeight;
  let ratio = devicePixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  c.scale(ratio, ratio);
  isInvalid = true;
};
window.addEventListener('resize', handleResize);

document.body.appendChild(canvas);
handleResize();
draw();

let query = matchMedia('(prefers-color-scheme: dark)');
try {
  query.addEventListener('change', () => (isInvalid = true));
} catch (e) {
  query.addListener(() => (isInvalid = true));
}

////////////////////////////////////////////////////////////////////////////////
// Theme

type Theme = 'light' | 'dark';

function inverseSystemTheme(): Theme {
  return darkMedia.matches ? 'light' : 'dark';
}

function updateTheme(theme: Theme | null) {
  isInvalid = true;
  document.body.dataset.theme = theme || undefined;
  localStorage.setItem('theme', String(theme));
}

$('#theme').addEventListener('click', () => {
  let theme = inverseSystemTheme();
  updateTheme(document.body.dataset.theme === theme ? null : theme);
});

let darkMedia = matchMedia('(prefers-color-scheme: dark)');

function onDarkModeChange() {
  if (document.body.dataset.theme !== inverseSystemTheme()) {
    updateTheme(null);
  }
}

try {
  // Newer browsers
  darkMedia.addEventListener('change', onDarkModeChange);
} catch (e) {
  // Older browsers
  darkMedia.addListener(onDarkModeChange);
}

////////////////////////////////////////////////////////////////////////////////
// Shareable URLs

function loadFromHash() {
  try {
    // Reads a string in length-prefix form separated by a null character. This
    // format is used because it's simple and also more compact than JSON.
    const readBuffer = () => {
      const zero = hash.indexOf('\0');
      if (zero < 0) throw 'No null character';
      const start = zero + 1;
      const end = start + Number(hash.slice(0, zero)) || 0;
      const buffer = hash.slice(start, end);
      if (end > hash.length) throw 'Invalid length';
      hash = hash.slice(end);
      return buffer;
    };

    // Extract the length-prefixed data
    let hash = atob(location.hash.slice(1));
    const code = readBuffer();
    const map = readBuffer();
    if (hash !== '') throw 'Unexpected extra data';

    finishLoading(utf8ToUTF16(code), utf8ToUTF16(map));
  } catch (e) {
    // Clear out an invalid hash and reset the UI
    if (location.hash !== '') {
      try {
        history.replaceState({}, '', location.pathname);
      } catch (e) { }
    }
    resetLoadingState();
  }
}

function updateHash(code: string, map: string) {
  try {
    const btoaLength = (n: number) => 4 * (((n + 2) / 3) | 0);
    const kMaxURLDisplayChars = 32 * 1024; // Chrome limits URLs to 32kb in size
    const url = new URL(location.href);
    url.hash = '#'; // Clear the data in the hash but leave the hash prefix
    const urlLength = url.href.length;

    // Do a cheap check to see if the URL will be too long
    let codeLength = `${code.length}\0`;
    let mapLength = `${map.length}\0`;
    let finalLength =
      urlLength +
      btoaLength(
        codeLength.length + code.length + mapLength.length + map.length,
      );
    if (finalLength >= kMaxURLDisplayChars) throw 'URL estimate too long';

    // Do the expensive check to see if the URL will be too long
    code = utf16ToUTF8(code);
    map = utf16ToUTF8(map);
    codeLength = `${code.length}\0`;
    mapLength = `${map.length}\0`;
    finalLength =
      urlLength +
      btoaLength(
        codeLength.length + code.length + mapLength.length + map.length,
      );
    if (finalLength >= kMaxURLDisplayChars) throw 'URL too long';

    // Only pay the cost of building the string now that we know it'll work
    const hash = '#' + btoa(`${codeLength}${code}${mapLength}${map}`);
    if (location.hash !== hash) {
      history.pushState({}, '', hash);
    }
  } catch (e) {
    // Push an empty hash instead if it's too big for a URL
    if (location.hash !== '') {
      try {
        history.pushState({}, '', location.pathname);
      } catch (e) { }
    }
  }
}

loadFromHash();
addEventListener('popstate', () => loadFromHash());

const exampleJS = `// index.tsx
import { h as u, Fragment as l, render as c } from "preact";

// counter.tsx
import { h as t, Component as i } from "preact";
import { useState as a } from "preact/hooks";
var n = class extends i {
constructor(e) {
  super(e);
  this.n = () => this.setState({ t: this.state.t + 1 });
  this.r = () => this.setState({ t: this.state.t - 1 });
  this.state.t = e.e;
}
render() {
  return t("div", {
    class: "counter"
  }, t("h1", null, this.props.label), t("p", null, t("button", {
    onClick: this.r
  }, "-"), " ", this.state.t, " ", t("button", {
    onClick: this.n
  }, "+")));
}
}, s = (r) => {
let [o, e] = a(r.e);
return t("div", {
  class: "counter"
}, t("h1", null, r.o), t("p", null, t("button", {
  onClick: () => e(o - 1)
}, "-"), " ", o, " ", t("button", {
  onClick: () => e(o + 1)
}, "+")));
};

// index.tsx
c(
u(l, null, u(n, {
  o: "Counter 1",
  e: 100
}), u(s, {
  o: "Counter 2",
  e: 200
})),
document.getElementById("root")
);
//# sourceMappingURL=example.js.map
`;

const exampleMap = `{
"version": 3,
"sources": ["index.tsx", "counter.tsx"],
"sourcesContent": ["import { h, Fragment, render } from 'preact'\\nimport { CounterClass, CounterFunction } from './counter'\\n\\nrender(\\n  <>\\n    <CounterClass label_=\\"Counter 1\\" initialValue_={100} />\\n    <CounterFunction label_=\\"Counter 2\\" initialValue_={200} />\\n  </>,\\n  document.getElementById('root')!,\\n)\\n", "import { h, Component } from 'preact'\\nimport { useState } from 'preact/hooks'\\n\\ninterface CounterProps {\\n  label_: string\\n  initialValue_: number\\n}\\n\\ninterface CounterState {\\n  value_: number\\n}\\n\\nexport class CounterClass extends Component<CounterProps, CounterState> {\\n  state: CounterState\\n\\n  constructor(props: CounterProps) {\\n    super(props)\\n    this.state.value_ = props.initialValue_\\n  }\\n\\n  increment_ = () => this.setState({ value_: this.state.value_ + 1 })\\n  decrement_ = () => this.setState({ value_: this.state.value_ - 1 })\\n\\n  render() {\\n    return <div class=\\"counter\\">\\n      <h1>{this.props.label}</h1>\\n      <p>\\n        <button onClick={this.decrement_}>-</button>\\n        {' '}\\n        {this.state.value_}\\n        {' '}\\n        <button onClick={this.increment_}>+</button>\\n      </p>\\n    </div>\\n  }\\n}\\n\\nexport let CounterFunction = (props: CounterProps) => {\\n  let [value, setValue] = useState(props.initialValue_)\\n  return <div class=\\"counter\\">\\n    <h1>{props.label_}</h1>\\n    <p>\\n      <button onClick={() => setValue(value - 1)}>-</button>\\n      {' '}\\n      {value}\\n      {' '}\\n      <button onClick={() => setValue(value + 1)}>+</button>\\n    </p>\\n  </div>\\n}\\n"],
"mappings": ";AAAA,SAAS,KAAAA,GAAG,YAAAC,GAAU,UAAAC,SAAc;;;ACApC,SAAS,KAAAC,GAAG,aAAAC,SAAiB;AAC7B,SAAS,YAAAC,SAAgB;AAWlB,IAAMC,IAAN,cAA2BF,EAAsC;AAAA,EAGtE,YAAYG,GAAqB;AAC/B,UAAMA,CAAK;AAIb,SAAAC,IAAa,MAAM,KAAK,SAAS,EAAEC,GAAQ,KAAK,MAAMA,IAAS,EAAE,CAAC;AAClE,SAAAC,IAAa,MAAM,KAAK,SAAS,EAAED,GAAQ,KAAK,MAAMA,IAAS,EAAE,CAAC;AAJhE,SAAK,MAAMA,IAASF,EAAMI;AAAA,EAC5B;AAAA,EAKA,SAAS;AACP,WAAOR,EAAC;AAAA,MAAI,OAAM;AAAA,OAChBA,EAAC,YAAI,KAAK,MAAM,KAAM,GACtBA,EAAC,WACCA,EAAC;AAAA,MAAO,SAAS,KAAKO;AAAA,OAAY,GAAC,GAClC,KACA,KAAK,MAAMD,GACX,KACDN,EAAC;AAAA,MAAO,SAAS,KAAKK;AAAA,OAAY,GAAC,CACrC,CACF;AAAA,EACF;AACF,GAEWI,IAAkB,CAACL,MAAwB;AACpD,MAAI,CAACM,GAAOC,CAAQ,IAAIT,EAASE,EAAMI,CAAa;AACpD,SAAOR,EAAC;AAAA,IAAI,OAAM;AAAA,KAChBA,EAAC,YAAII,EAAMQ,CAAO,GAClBZ,EAAC,WACCA,EAAC;AAAA,IAAO,SAAS,MAAMW,EAASD,IAAQ,CAAC;AAAA,KAAG,GAAC,GAC5C,KACAA,GACA,KACDV,EAAC;AAAA,IAAO,SAAS,MAAMW,EAASD,IAAQ,CAAC;AAAA,KAAG,GAAC,CAC/C,CACF;AACF;;;AD9CAG;AAAA,EACEC,EAAAC,GAAA,MACED,EAACE,GAAA;AAAA,IAAaC,GAAO;AAAA,IAAYC,GAAe;AAAA,GAAK,GACrDJ,EAACK,GAAA;AAAA,IAAgBF,GAAO;AAAA,IAAYC,GAAe;AAAA,GAAK,CAC1D;AAAA,EACA,SAAS,eAAe,MAAM;AAChC;",
"names": ["h", "Fragment", "render", "h", "Component", "useState", "CounterClass", "props", "increment_", "value_", "decrement_", "initialValue_", "CounterFunction", "value", "setValue", "label_", "render", "h", "Fragment", "CounterClass", "label_", "initialValue_", "CounterFunction"]
}
`;
