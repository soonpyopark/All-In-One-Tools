import assert from 'node:assert/strict';
import { extractChanges, extractPriorHistory, releaseBody } from './publish-release.mjs';

const prev = {
  name: 'v1.0.1.9',
  tagName: 'v1.0.1-9',
  body: `## 변경
- 아이콘 초기화
- MSI 업그레이드 수정

## 파일
- a.msi
- b.zip
`,
};

const withHistory = {
  name: 'v1.0.1.9',
  tagName: 'v1.0.1-9',
  body: `## 변경
- 아홉

## 파일
- a.msi

## 이전 버전 이력

### v1.0.1.8
- 여덟
`,
};

assert.equal(extractChanges(prev.body), '- 아이콘 초기화\n- MSI 업그레이드 수정');
assert.equal(extractPriorHistory(prev.body), '');
assert.equal(extractPriorHistory(withHistory.body), '### v1.0.1.8\n- 여덟');

const body = releaseBody('- 열', ['x.msi'], prev);
assert.match(body, /^## 변경\n- 열\n/);
assert.match(body, /## 파일\n- x\.msi\n/);
assert.match(body, /## 이전 버전 이력\n\n### v1\.0\.1\.9\n- 아이콘 초기화\n- MSI 업그레이드 수정\n/);
assert.doesNotMatch(body, /a\.msi/);

const chained = releaseBody('- 열', ['x.msi'], withHistory);
assert.match(chained, /### v1\.0\.1\.9\n- 아홉\n/);
assert.match(chained, /### v1\.0\.1\.8\n- 여덟\n/);

assert.equal(releaseBody('- only', ['f.zip'], null).includes('이전 버전 이력'), false);

console.log('publish-release-notes.test.mjs: ok');
