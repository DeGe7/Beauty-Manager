import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDeleteAttendance } from '../artifacts/barber-manager/src/data/attendance-deletion.ts';

const now = Date.parse('2026-11-12T15:00:00.000Z');
const recent = new Date(now - 23 * 60 * 60 * 1000).toISOString();
const expired = new Date(now - 25 * 60 * 60 * 1000).toISOString();
const atLimit = new Date(now - 24 * 60 * 60 * 1000).toISOString();

test('Gestor e DEV/ADMIN podem excluir atendimentos antigos', () => {
  assert.equal(canDeleteAttendance(expired, 'gestor', now), true);
  assert.equal(canDeleteAttendance(expired, 'dev-admin', now), true);
});

test('profissionais e recepção continuam sujeitos ao limite de 24 horas', () => {
  for (const role of ['recepcao', 'barbeiro', 'manicure', 'vendedor', 'e2e-custom']) {
    assert.equal(canDeleteAttendance(expired, role, now), false, `${role} deve manter o limite`);
  }
  assert.equal(canDeleteAttendance(atLimit, 'barbeiro', now), false);
});

test('atendimentos recentes podem ser excluídos por papéis operacionais', () => {
  for (const role of ['recepcao', 'barbeiro', 'manicure', 'vendedor']) {
    assert.equal(canDeleteAttendance(recent, role, now), true, `${role} pode excluir dentro do prazo`);
  }
});
