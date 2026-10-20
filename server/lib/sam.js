import { db } from '../db.js';

/**
 * Position de licence = droits achetes - consommation mesuree, par produit.
 * C'est le coeur du SAM : un ecart negatif chiffre directement le risque
 * d'audit editeur, un ecart positif important chiffre le gaspillage.
 *
 * Seuil de surdimensionnement : en dessous de 70% d'utilisation, les licences
 * non utilisees sont considerees comme une economie reelle (un petit tampon
 * a 85-90% est normal et n'est pas du gaspillage).
 */
export const OVERSIZED_BELOW = 0.7;

/**
 * @returns {'unlicensed'|'over_deployed'|'limit_reached'|'oversized'|'compliant'}
 */
export function statusFor(entitled, consumed) {
  if (entitled === 0 && consumed > 0) return 'unlicensed';
  if (consumed > entitled) return 'over_deployed';
  if (entitled > 0 && consumed === entitled) return 'limit_reached';
  if (entitled > 0 && consumed / entitled < OVERSIZED_BELOW) return 'oversized';
  return 'compliant';
}

const round2 = n => Math.round(n * 100) / 100;

export function computePosition() {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.vendor, p.metric, p.category,
      COALESCE((SELECT SUM(quantity)    FROM licence_entitlements WHERE product_id = p.id), 0) AS entitled,
      COALESCE((SELECT SUM(annual_cost) FROM licence_entitlements WHERE product_id = p.id), 0) AS annual_cost,
      COALESCE((SELECT SUM(units)       FROM software_installations WHERE product_id = p.id), 0) AS consumed
    FROM software_products p
    ORDER BY p.vendor, p.name
  `).all();

  return rows.map(r => {
    const gap = r.entitled - r.consumed;
    const unitCost = r.entitled > 0 ? r.annual_cost / r.entitled : 0;
    const status = statusFor(r.entitled, r.consumed);
    return {
      ...r,
      annual_cost: round2(r.annual_cost),
      gap,
      utilisation: r.entitled > 0 ? round2(r.consumed / r.entitled) : null,
      unit_cost: round2(unitCost),
      status,
      // Gaspillage chiffre uniquement quand le produit est surdimensionne.
      potential_saving: status === 'oversized' ? round2(gap * unitCost) : 0,
      // Exposition chiffree au prix du marche des droits deja achetes : estimation
      // basse (le tarif de regularisation editeur est generalement superieur).
      exposure: status === 'over_deployed' ? round2(-gap * unitCost) : 0,
    };
  });
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function upcomingRenewals(days = 90, today = new Date().toISOString().slice(0, 10)) {
  const end = addDays(today, days);
  return db.prepare(`
    SELECT e.id, e.product_id, p.name AS product_name, p.vendor, e.quantity, e.annual_cost,
           e.contract_ref, e.renewal_date
    FROM licence_entitlements e JOIN software_products p ON p.id = e.product_id
    WHERE e.renewal_date IS NOT NULL AND e.renewal_date >= ? AND e.renewal_date <= ?
    ORDER BY e.renewal_date, p.name
  `).all(today, end);
}

export function computeSummary({ today } = {}) {
  const position = computePosition();
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const entitled = sum(position, p => p.entitled);
  const consumed = sum(position, p => Math.min(p.consumed, p.entitled)); // consommation couverte
  const renewals = upcomingRenewals(90, today);
  return {
    products: position.length,
    annual_cost: round2(sum(position, p => p.annual_cost)),
    utilisation: entitled > 0 ? round2(consumed / entitled) : null,
    savings_identified: round2(sum(position, p => p.potential_saving)),
    releasable_licences: sum(position.filter(p => p.status === 'oversized'), p => p.gap),
    exposures: position.filter(p => p.status === 'over_deployed' || p.status === 'unlicensed').length,
    exposure_amount: round2(sum(position, p => p.exposure)),
    renewals_90d: renewals.length,
    renewals_90d_amount: round2(sum(renewals, r => r.annual_cost)),
  };
}
