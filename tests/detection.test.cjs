const test = require('node:test');
const assert = require('node:assert/strict');
const { core } = require('./helpers.cjs');
const full = (total, items) => ({ total, items, coverage: 'full', checkedAt: 123 });

test('first snapshot creates a baseline without change alert', () => {
  const current = full(1, ['1']);
  const diff = core.compareSnapshots(null, current);
  assert.equal(core.shouldAlert({}, diff), false);
  assert.equal(core.buildHistoryEvent(null, current, diff).type, 'baseline');
});
test('added/removed IDs at the same total are identified and deduplicated', () => {
  const diff = core.compareSnapshots(full(3, ['1','2','3']), full(3, ['1','3','4','4']));
  assert.deepEqual(diff.added, ['4']); assert.deepEqual(diff.removed, ['2']);
  assert.equal(diff.delta, 0); assert.equal(core.shouldAlert({}, diff), true);
});
test('reordering IDs creates no event', () => {
  const previous = full(2, ['1','2']), current = full(2, ['2','1']);
  const diff = core.compareSnapshots(previous, current);
  assert.equal(core.buildHistoryEvent(previous, current, diff), null);
});
test('pagination changes do not become new/removed ticket alerts', () => {
  const diff = core.compareSnapshots({ total: 8, items: ['1','2'], coverage: 'visible' },
    { total: 8, items: ['3','4'], coverage: 'visible' });
  assert.deepEqual(diff.added, []); assert.deepEqual(diff.removed, []);
  assert.equal(core.shouldAlert({ alertOnRemovedItem: true }, diff), false);
});
test('partial lists still report a confirmed count increase', () => {
  const diff = core.compareSnapshots({ total:8, items:['1'], coverage:'visible' }, { total:9, items:['2'], coverage:'visible' });
  assert.equal(core.shouldAlert({}, diff), true);
});
test('removal preferences are respected', () => {
  const diff = core.compareSnapshots(full(2,['1','2']),full(1,['1']));
  assert.equal(core.shouldAlert({},diff),false);
  assert.equal(core.shouldAlert({alertOnRemovedItem:true},diff),true);
});
test('a counter without the configured nonempty list is not a valid snapshot', () => {
  assert.equal(core.validateSnapshot({counterSelector:'#c',itemSelector:'.id'},
    {total:8,counterFound:true,items:[],invalidItems:0}), 'PAGE_LOADING');
});
test('loading, invalid IDs, negative totals and inconsistent totals are rejected', () => {
  const config = {counterSelector:'#c',itemSelector:'.id'};
  const good = {total:1,counterFound:true,items:['1'],invalidItems:0};
  for (const [patch,expected] of [[{readyState:'loading'},'PAGE_LOADING'],[{invalidItems:1},'SELECTOR_FAILED'],
    [{total:-1},'SELECTOR_FAILED'],[{total:0},'READ_ERROR']]) {
    assert.equal(core.validateSnapshot(config,{...good,...patch}),expected);
  }
});
test('empty IDs without a counter are ambiguous; a zero counter can confirm empty', () => {
  assert.equal(core.validateSnapshot({itemSelector:'.id'},{total:null,items:[],invalidItems:0}),'PAGE_LOADING');
  assert.equal(core.validateSnapshot({counterSelector:'#c',itemSelector:'.id'},{total:0,counterFound:true,items:[],invalidItems:0}),null);
});
