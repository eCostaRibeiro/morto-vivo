import assert from 'node:assert/strict';
import test from 'node:test';

import { extractMeta } from '../lib/text.js';

test('retains classification and product metadata without risk-only fields', () => {
  const html = `
    <meta http-equiv="refresh" content="5;url=https://example.com">
    <input type="password" name="password">
    <form action="/login" method="post"></form>
    <script type="application/ld+json">
      {"@type":"Product","name":"Example item","brand":{"name":"Example brand"}}
    </script>
  `;

  const meta = extractMeta(html);
  assert.equal(meta.hasPassword, true);
  assert.equal(meta.refresh, '5;url=https://example.com');
  assert.equal(meta.product.brand, 'Example brand');
  assert.equal('forms' in meta, false);
  assert.equal('fieldNames' in meta, false);
  assert.equal('obfuscated' in meta, false);
});
