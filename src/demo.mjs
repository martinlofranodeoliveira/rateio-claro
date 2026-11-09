import { validateProject } from './core.mjs';

/** Exemplo autoral fictício. Cada chamada entrega uma cópia congelada nova. */
export function demoProject() {
  return validateProject({
    version: 1,
    title: 'Um sábado entre amigos',
    currency: 'BRL',
    participants: [
      { id: 'ana', name: 'Ana' },
      { id: 'bruno', name: 'Bruno' },
      { id: 'clara', name: 'Clara' },
      { id: 'diego', name: 'Diego' },
    ],
    expenses: [
      {
        id: 'almoco', description: 'Almoço compartilhado', payer: 'ana', amountCents: 12001,
        shares: [
          { participant: 'ana', weight: 1 }, { participant: 'bruno', weight: 1 },
          { participant: 'clara', weight: 1 }, { participant: 'diego', weight: 1 },
        ],
      },
      {
        id: 'transporte', description: 'Transporte do grupo', payer: 'bruno', amountCents: 6900,
        shares: [
          { participant: 'ana', weight: 1 }, { participant: 'bruno', weight: 2 },
          { participant: 'clara', weight: 1 }, { participant: 'diego', weight: 2 },
        ],
      },
      {
        id: 'ingressos', description: 'Ingressos da visita', payer: 'clara', amountCents: 8000,
        shares: [{ participant: 'ana', weight: 1 }, { participant: 'clara', weight: 1 }],
      },
    ],
    transfers: [{ id: 'acerto-01', from: 'diego', to: 'ana', amountCents: 2000, note: 'Acerto declarado no exemplo' }],
  });
}
