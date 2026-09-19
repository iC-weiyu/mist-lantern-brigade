import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSave, validateImportedSave } from './engine.mjs';
import { createTestSave } from './test-workbench.mjs';

// The original single-save file remains an untouched migration source.
export class SaveSlots {
  constructor(legacyPath, content) {
    this.content = content;
    this.file = `${legacyPath.replace(/\.json$/i, '')}.slots.json`;
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.data.version !== 1 || !Array.isArray(this.data.slots) || this.data.slots.length !== 3) throw new Error('存档位文件无效');
      this.data.slots.forEach((slot, index) => {
        if (slot && slot.id !== String(index + 1)) throw new Error('存档位编号无效');
        if (slot) slot.save = validateImportedSave(slot.save, content);
      });
      if (this.data.activeSlotId === null) {
        if (this.data.slots.some(Boolean)) throw new Error('存在存档时必须指定当前存档位');
      } else {
        this.index(this.data.activeSlotId);
        if (!this.data.slots[Number(this.data.activeSlotId) - 1]) throw new Error('当前存档位为空');
      }
    } else {
      const legacy = fs.existsSync(legacyPath) ? validateImportedSave(JSON.parse(fs.readFileSync(legacyPath, 'utf8')), content) : createSave(content);
      this.data = { version: 1, activeSlotId: '1', slots: [{ id: '1', name: '旅团一', save: legacy }, null, null] };
      this.write(this.data);
    }
    this.testFile = `${legacyPath.replace(/\.json$/i, '')}.test.json`;
    this.testData = fs.existsSync(this.testFile) ? JSON.parse(fs.readFileSync(this.testFile, 'utf8')) : { version: 1, active: false, save: null };
    if (this.testData.version !== 1 || (this.testData.active && !this.testData.save)) throw new Error('测试存档数据无效');
    if (this.testData.save) this.testData.save = validateImportedSave(this.testData.save, content);
    this.selectionToken = crypto.randomUUID();
  }
  index(id) {
    if (!['1', '2', '3'].includes(id)) throw new Error('请选择 1～3 号存档位');
    return Number(id) - 1;
  }
  get save() {
    if (this.testData.active) return this.testData.save;
    if (this.data.activeSlotId === null) return null;
    return this.data.slots[this.index(this.data.activeSlotId)].save;
  }
  get activeSlotId() { return this.testData.active ? 'test' : this.data.activeSlotId; }
  assertSelection(slotId, selectionToken) {
    if (slotId !== this.activeSlotId || selectionToken !== this.selectionToken) throw new Error('存档已切换或服务已更新，请刷新页面后继续');
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.data = data;
  }
  commit(save) {
    if (this.testData.active) {
      save.updatedAt = new Date().toISOString();
      this.writeTest({ ...this.testData, save }); return;
    }
    if (this.data.activeSlotId === null) throw new Error('请先新建存档');
    const next = structuredClone(this.data);
    save.updatedAt = new Date().toISOString();
    next.slots[this.index(next.activeSlotId)].save = save;
    this.write(next);
  }
  select(id, create = false, name = '') {
    if (id === 'test') {
      if (create && this.testData.save) throw new Error('测试存档已存在');
      this.writeTest({ version: 1, active: true, save: this.testData.save || createTestSave(this.content) });
      this.selectionToken = crypto.randomUUID(); return;
    }
    const index = this.index(id); const next = structuredClone(this.data);
    if (create) {
      if (next.slots[index]) throw new Error('这个位置已有存档，请选择空位置新建');
      next.slots[index] = { id, name: String(name).trim().slice(0, 20) || `旅团${['一', '二', '三'][index]}`, save: createSave(this.content) };
    } else if (!next.slots[index]) throw new Error('这个位置尚未建立存档');
    next.activeSlotId = id;
    this.write(next);
    if (this.testData.active) this.writeTest({ ...this.testData, active: false });
    this.selectionToken = crypto.randomUUID();
  }
  writeTest(data) {
    fs.writeFileSync(`${this.testFile}.tmp`, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(`${this.testFile}.tmp`, this.testFile);
    this.testData = data;
  }
  remove(id) {
    const index = this.index(id); const next = structuredClone(this.data);
    if (!next.slots[index]) throw new Error('这个位置没有可删除的存档');
    next.slots[index] = null;
    if (next.activeSlotId === id) next.activeSlotId = next.slots.find(Boolean)?.id || null;
    this.write(next);
    this.selectionToken = crypto.randomUUID();
    return { deletedSlotId: id, activeSlotId: next.activeSlotId };
  }
  state() {
    return {
      activeSlotId: this.activeSlotId, selectionToken: this.selectionToken,
      testSlot: { id: 'test', name: '测试存档', empty: !this.testData.save, tickets: this.testData.save?.currencies.tickets ?? 999, coins: this.testData.save?.currencies.coins ?? 99999999, shards: this.testData.save?.currencies.contractShards ?? 9999, owned: Object.keys(this.testData.save?.owned || {}).length },
      slots: this.data.slots.map((slot, index) => slot ? {
        id: slot.id, name: slot.name, empty: false, updatedAt: slot.save.updatedAt,
        tickets: slot.save.currencies.tickets, pulls: slot.save.gacha.totalPulls,
        owned: Object.keys(slot.save.owned).length, cleared: slot.save.story.clearedStages.length,
        story: slot.save.story.prologue,
      } : { id: String(index + 1), empty: true }),
    };
  }
}
