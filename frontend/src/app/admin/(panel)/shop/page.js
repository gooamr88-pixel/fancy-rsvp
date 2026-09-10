'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import adminApi from '../../_lib/adminApi';
import { SHOP_CURRENCY, SHOP_MIN_ORDER_QTY, SHOP_PATH, SHOP_UNIT_DEFAULT } from '../../../utils/shopLinks';
import usePermissions from '../../_hooks/usePermissions';
import DataTable from '../../_components/DataTable';
import { PageLoading } from '../../_components/Spinner';
import Modal, { Button } from '../../_components/Modal';
import { T, card } from '../../_components/theme';
import { useAlert } from '../../_components/AlertContext';
import { Field } from '../../_components/Field';
import { makeImageUploadHandler, makeMultiImageUploadHandler } from '../../_lib/uploadImage';
import { adminTime } from '../../_lib/format';

/**
 * PRINTED INVITATIONS — the super-admin control centre.
 *
 * Everything the physical-card catalogue at /printed-invitations shows is
 * edited here and nowhere else: the pieces, their photographs, the collections
 * and labels people filter by, the arrangement, and whether the section
 * appears on the site at all.
 *
 * Five tabs, because they are five different jobs:
 *   Products     the pieces themselves, in the order visitors see them
 *   Collections  the filter chips (Wedding, Graduation, …)
 *   Labels       "New", "Best seller" — free text, own colours, optional filter
 *   Settings     WhatsApp number, hero copy, and the placement switches
 *   Interest     who tapped through to WhatsApp, and on what
 *
 * ── Two things worth knowing before editing this file ──
 *
 * 1. PRICE IS OPTIONAL. An empty price field means "Price on request" on the
 *    public page, not zero. The dollars↔cents conversion below preserves that
 *    distinction deliberately; collapsing it publishes cards that cost nothing.
 *
 * 2. IMAGES NEED A PRODUCT ROW. shop_product_images has a FK, so a brand-new
 *    piece cannot own photographs until it exists. The editor collects them in
 *    state and syncs after the product saves, so the admin never has to save
 *    twice to add a photo.
 */

const EMPTY_PRODUCT = {
  title: '', slug: '', tagline: '', description: '', categoryId: '',
  priceDollars: '', compareAtDollars: '', currency: SHOP_CURRENCY, priceUnit: '',
  minOrderQty: '', leadTimeText: '', whatsappMessage: '',
  metaTitle: '', metaDescription: '',
  isPublished: false, isFeatured: false, isSoldOut: false,
  badgeIds: [], highlights: [], specs: [], images: [],
};

const EMPTY_CATEGORY = {
  name: '', slug: '', description: '', sortOrder: '0', isPublished: true,
  coverImageUrl: '', coverImageAlt: '',
};
const EMPTY_BADGE = { label: '', bgColor: '#8A6D34', textColor: '#FFFFFF', isFilterable: true, sortOrder: '0', isPublished: true };

const TABS = [
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Collections' },
  { key: 'badges', label: 'Labels' },
  { key: 'settings', label: 'Settings' },
  { key: 'inquiries', label: 'Interest' },
];

const inputStyle = {
  width: '100%',
  padding: '9px 11px',
  border: `1px solid ${T.border}`,
  borderRadius: T.radiusSm,
  fontSize: 13,
  background: T.surfaceAlt,
  color: T.text900,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  boxSizing: 'border-box',
};

/** Cents → the dollars string an admin types. Null stays empty, never "0". */
const centsToDollars = (cents) => (cents == null ? '' : String(cents / 100));

/**
 * Dollars string → integer cents, or null.
 *
 * An empty field MUST become null and not 0 — that null is what renders "Price
 * on request". Math.round rather than a bare multiply because 8.99 * 100 is
 * 898.9999999999999 in binary floating point, and truncating that stores $8.98.
 */
function dollarsToCents(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export default function ShopAdminPage() {
  const [tab, setTab] = useState('products');

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>
          Shop
        </h1>
        <p style={{ fontSize: 13, color: T.text500, margin: '4px 0 0' }}>
          Everything sold at {SHOP_PATH} — cards, envelopes, signage, screens and
          door hardware, ordered over WhatsApp rather than checkout.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              minHeight: 40,
              padding: '0 16px',
              borderRadius: T.radiusSm,
              border: `1px solid ${tab === t.key ? T.primary : T.border}`,
              background: tab === t.key ? T.primarySoft : T.surface,
              color: tab === t.key ? T.primaryDark : T.text500,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all .2s cubic-bezier(.16,1,.3,1)',
            }}
            aria-pressed={tab === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'badges' && <BadgesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'inquiries' && <InquiriesTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Products
   ═══════════════════════════════════════════════════════════════════════ */

function ProductsTab() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * Fetch-on-mount as an inline async IIFE keyed on a nonce — the pattern the
   * rest of this panel uses (see cms/page.js).
   *
   * NOT a useCallback that closes over showAlert with the effect depending on
   * it: AlertContext passes a fresh object literal as its provider value, so
   * showAlert's identity changes on every provider render, and an effect
   * depending on it refetches the whole catalogue every time any alert opens
   * or closes.
   */
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const [p, c, b] = await Promise.all([
          adminApi.get('/shop/products'),
          adminApi.get('/shop/categories'),
          adminApi.get('/shop/badges'),
        ]);
        if (ignore) return;
        setProducts(p?.products || []);
        setCategories(c?.categories || []);
        setBadges(b?.badges || []);
        setError(null);
      } catch (err) {
        if (!ignore) setError(err?.message || 'Failed to load the catalogue.');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const categoryName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const openNew = () => { setEditing(null); setForm(EMPTY_PRODUCT); setOpen(true); };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      title: row.title || '',
      slug: row.slug || '',
      tagline: row.tagline || '',
      description: row.description || '',
      categoryId: row.category_id || '',
      priceDollars: centsToDollars(row.price_cents),
      compareAtDollars: centsToDollars(row.compare_at_cents),
      currency: row.currency || SHOP_CURRENCY,
      priceUnit: row.price_unit || '',
      minOrderQty: row.min_order_qty == null ? '' : String(row.min_order_qty),
      leadTimeText: row.lead_time_text || '',
      whatsappMessage: row.whatsapp_message || '',
      metaTitle: row.meta_title || '',
      metaDescription: row.meta_description || '',
      isPublished: !!row.is_published,
      isFeatured: !!row.is_featured,
      isSoldOut: !!row.is_sold_out,
      badgeIds: (row.badges || []).map((b) => b.id),
      highlights: Array.isArray(row.highlights) ? row.highlights : [],
      specs: Array.isArray(row.specs) ? row.specs : [],
      images: (row.images || []).map((i) => ({
        id: i.id, url: i.image_url, alt: i.alt_text || '',
      })),
    });
    setOpen(true);
  };

  /**
   * Syncs the gallery after the product row exists.
   *
   * Images the admin removed are deleted, new ones are created, and everything
   * keeps the order shown in the editor. Position is written as the array index
   * so "move up" in the UI is literally the stored sort_order.
   */
  const syncImages = async (productId, wanted, original) => {
    const keptIds = new Set(wanted.filter((i) => i.id).map((i) => i.id));
    const removed = (original || []).filter((i) => !keptIds.has(i.id));
    await Promise.all(removed.map((i) => adminApi.del(`/shop/images/${i.id}`)));

    for (let index = 0; index < wanted.length; index++) {
      const img = wanted[index];
      if (img.id) {
        await adminApi.patch(`/shop/images/${img.id}`, { altText: img.alt, sortOrder: index });
      } else {
        await adminApi.post(`/shop/products/${productId}/images`, {
          imageUrl: img.url, altText: img.alt, sortOrder: index,
        });
      }
    }
  };

  const save = async () => {
    if (!form.title.trim()) { showAlert('A title is required.', 'Missing title', 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        slug: form.slug || undefined,
        tagline: form.tagline,
        description: form.description,
        categoryId: form.categoryId || null,
        priceCents: dollarsToCents(form.priceDollars),
        compareAtCents: dollarsToCents(form.compareAtDollars),
        currency: form.currency,
        priceUnit: form.priceUnit,
        minOrderQty: form.minOrderQty === '' ? null : form.minOrderQty,
        leadTimeText: form.leadTimeText,
        whatsappMessage: form.whatsappMessage,
        metaTitle: form.metaTitle,
        metaDescription: form.metaDescription,
        isPublished: form.isPublished,
        isFeatured: form.isFeatured,
        isSoldOut: form.isSoldOut,
        badgeIds: form.badgeIds,
        highlights: form.highlights,
        specs: form.specs,
      };

      const res = editing
        ? await adminApi.patch(`/shop/products/${editing.id}`, payload)
        : await adminApi.post('/shop/products', payload);

      const productId = res?.product?.id || editing?.id;
      if (productId) await syncImages(productId, form.images, editing?.images || []);

      setOpen(false);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to save the product.', 'Error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await showConfirm(
      `Delete "${row.title}"? Its photographs go with it. Recorded WhatsApp interest is kept.`,
      'Delete product',
    );
    if (!ok) return;
    try {
      await adminApi.del(`/shop/products/${row.id}`);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to delete the product.', 'Error', 'error');
    }
  };

  const togglePublished = async (row) => {
    try {
      await adminApi.patch(`/shop/products/${row.id}`, { isPublished: !row.is_published });
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to update the product.', 'Error', 'error');
    }
  };

  /** Moves a piece one place in the public order and persists the whole list. */
  const move = async (index, delta) => {
    const next = [...products];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setProducts(next); // optimistic — the list is the control, it must feel instant
    try {
      await adminApi.post('/shop/products/reorder', { order: next.map((p) => p.id) });
    } catch (err) {
      showAlert(err?.message || 'Failed to save the new order.', 'Error', 'error');
      await load();
    }
  };

  if (loading) return <PageLoading />;

  const columns = [
    {
      key: 'title',
      header: 'Piece',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Thumb src={row.images?.[0]?.image_url} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: T.text900, fontSize: 13 }}>{row.title}</div>
            <div style={{ fontSize: 11.5, color: T.text500 }}>
              /{row.slug}
              {row.category_id ? ` · ${categoryName[row.category_id] || '—'}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'labels',
      header: 'Labels',
      render: (row) => (
        (row.badges || []).length === 0
          ? <span style={{ color: T.text400, fontSize: 12 }}>—</span>
          : (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {row.badges.map((b) => (
                <span key={b.id} style={{ background: b.bg_color, color: b.text_color, fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 4, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {b.label}
                </span>
              ))}
            </div>
          )
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (row) => (
        row.price_cents == null
          ? <span style={{ color: T.primaryDark, fontSize: 12, fontWeight: 600 }}>On request</span>
          : <span style={{ fontWeight: 700, fontSize: 13 }}>{(row.price_cents / 100).toFixed(2)} {row.currency}</span>
      ),
    },
    {
      key: 'interest',
      header: 'Views / asks',
      render: (row) => (
        <span style={{ fontSize: 12, color: T.text500 }}>
          {row.view_count || 0} / <strong style={{ color: T.text900 }}>{row.inquiry_count || 0}</strong>
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Live',
      render: (row) => (
        <button
          type="button"
          onClick={() => manage && togglePublished(row)}
          disabled={!manage}
          title={manage ? 'Show or hide this piece on the public page' : 'You do not have permission to change this'}
          style={{
            minHeight: 30, padding: '0 10px', borderRadius: 999, cursor: manage ? 'pointer' : 'default',
            fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
            border: `1px solid ${row.is_published ? 'rgba(16,185,129,.25)' : T.border}`,
            background: row.is_published ? 'rgba(16,185,129,.10)' : T.surfaceAlt,
            color: row.is_published ? T.successDark : T.text500,
          }}
        >
          {row.is_published ? 'LIVE' : 'HIDDEN'}
          {row.is_sold_out ? ' · SOLD OUT' : ''}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const index = products.findIndex((p) => p.id === row.id);
        return (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {manage && (
              <>
                <IconBtn label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</IconBtn>
                <IconBtn label="Move down" disabled={index === products.length - 1} onClick={() => move(index, 1)}>↓</IconBtn>
              </>
            )}
            <Button variant="ghost" onClick={() => openEdit(row)} style={{ padding: '6px 12px', fontSize: 12 }}>
              {manage ? 'Edit' : 'View'}
            </Button>
            {manage && (
              <Button variant="danger" onClick={() => remove(row)} style={{ padding: '6px 12px', fontSize: 12 }}>Delete</Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div style={{ ...card, padding: '14px 18px', marginBottom: 16, fontSize: 12.5, color: T.text500, lineHeight: 1.7 }}>
        The list below <strong style={{ color: T.text900 }}>is</strong> the order visitors see. Use ↑ / ↓ to put a
        new piece at the top — the public page&apos;s &ldquo;Featured&rdquo; sort reads exactly this arrangement.
        Leave a price empty to publish it as <em>Price on request</em>.
      </div>

      {error && (
        <div style={{ ...card, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: T.dangerDark, borderColor: 'rgba(239,68,68,.25)' }}>
          {error} <button type="button" onClick={load} style={{ marginLeft: 8, background: 'none', border: 0, color: T.primaryDark, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      <DataTable
        title={`Products (${products.length})`}
        columns={columns}
        rows={products}
        rowKey={(r) => r.id}
        emptyText="No pieces yet. Add the first one to open the catalogue."
        onRefresh={load}
        actions={manage ? <Button variant="primary" onClick={openNew}>Add a piece</Button> : null}
      />

      <ProductEditor
        open={open}
        onClose={() => setOpen(false)}
        form={form}
        setForm={setForm}
        categories={categories}
        badges={badges}
        editing={editing}
        manage={manage}
        saving={saving}
        onSave={save}
      />
    </>
  );
}

/* ── The editor ───────────────────────────────────────────────────────── */

function ProductEditor({ open, onClose, form, setForm, categories, badges, editing, manage, saving, onSave }) {
  const { showAlert } = useAlert();
  const [uploading, setUploading] = useState(false);

  const set = (patch) => setForm({ ...form, ...patch });

  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });

  /* MANY photos at once.
     This used to be the single-file handler, which reads files[0] and drops
     the rest — so a six-photo product meant six trips through the picker.

     The appender is a FUNCTIONAL update on purpose: uploads land one after
     another, and `setForm({ ...form, ... })` would close over a stale `form`
     and leave each photo overwriting the one before it. */
  const addImages = makeMultiImageUploadHandler({
    kind: 'shop',
    onImage: (url) => setForm((f) => ({ ...f, images: [...f.images, { url, alt: '' }] })),
    setUploading,
    showAlert,
    setProgress: (done, total) => setUploadProgress({ done, total }),
  });

  const moveImage = (index, delta) => {
    const next = [...form.images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ images: next });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={860}
      title={editing ? `Edit — ${editing.title}` : 'Add a piece'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {manage && (
            <Button variant="primary" onClick={onSave} disabled={saving || uploading}>
              {saving ? 'Saving…' : 'Save piece'}
            </Button>
          )}
        </>
      )}
    >
      <SectionLabel>The piece</SectionLabel>
      <Field label="Title">
        <input value={form.title} onChange={(e) => set({ title: e.target.value })} style={inputStyle} placeholder="e.g. Velvet & Gold Wedding Suite" />
      </Field>
      <Field label="Tagline — one line under the title">
        <input value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} style={inputStyle} placeholder="e.g. Gold-foiled on 350gsm cotton board" />
      </Field>
      <Field label="URL slug (optional — generated from the title)">
        <input value={form.slug} onChange={(e) => set({ slug: e.target.value })} style={inputStyle} placeholder="velvet-gold-wedding-suite" />
      </Field>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={5}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 110 }}
          placeholder="What it is, how it is made, what makes it worth holding. Blank lines start a new paragraph."
        />
      </Field>

      <SectionLabel>Photographs</SectionLabel>
      <p style={{ fontSize: 12, color: T.text500, margin: '0 0 10px', lineHeight: 1.6 }}>
        The first image is the cover; the second is shown on hover in the grid. Drag order with ↑ / ↓.
        Alt text is what a screen reader and a search engine read.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {form.images.map((img, i) => (
          <div key={img.id || `${img.url}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: 8, background: T.surfaceAlt }}>
            <Thumb src={img.url} size={52} />
            <input
              value={img.alt}
              onChange={(e) => {
                const next = [...form.images];
                next[i] = { ...next[i], alt: e.target.value };
                set({ images: next });
              }}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              placeholder={i === 0 ? 'Alt text (cover image)' : 'Alt text'}
            />
            {manage && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <IconBtn label="Move up" disabled={i === 0} onClick={() => moveImage(i, -1)}>↑</IconBtn>
                <IconBtn label="Move down" disabled={i === form.images.length - 1} onClick={() => moveImage(i, 1)}>↓</IconBtn>
                <IconBtn label="Remove" onClick={() => set({ images: form.images.filter((_, k) => k !== i) })}>×</IconBtn>
              </div>
            )}
          </div>
        ))}
        {form.images.length === 0 && (
          <p style={{ fontSize: 12.5, color: T.text400, margin: 0 }}>
            No photographs yet. The card will show a placeholder monogram until you add one.
          </p>
        )}
      </div>
      {manage && (
        <label style={{ ...inputStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', width: 'auto', padding: '9px 16px', fontWeight: 700 }}>
          {uploading
            ? (uploadProgress.total > 1
              ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
              : 'Uploading…')
            : '+ Add photographs'}
          {/* `multiple`: pick a whole set in one go. The count in the label is
              why the uploads are sequential — a parallel batch has no
              meaningful "3 of 6". */}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={addImages}
            style={{ display: 'none' }}
            disabled={uploading}
          />
        </label>
      )}

      <SectionLabel>Price</SectionLabel>
      <p style={{ fontSize: 12, color: T.text500, margin: '0 0 10px', lineHeight: 1.6 }}>
        Leave the price empty to publish this piece as <strong style={{ color: T.text900 }}>&ldquo;Price on request&rdquo;</strong> —
        the page then invites a quote instead of showing a number.
      </p>
      <TwoUp>
        <Field label="Price">
          <input value={form.priceDollars} onChange={(e) => set({ priceDollars: e.target.value })} style={inputStyle} placeholder="8.99 — or leave empty" inputMode="decimal" />
        </Field>
        <Field label="Was (optional, shown struck through)">
          <input value={form.compareAtDollars} onChange={(e) => set({ compareAtDollars: e.target.value })} style={inputStyle} placeholder="12.99" inputMode="decimal" />
        </Field>
      </TwoUp>
      <TwoUp>
        <Field label="Currency">
          <input value={form.currency} onChange={(e) => set({ currency: e.target.value })} style={inputStyle} placeholder={SHOP_CURRENCY} maxLength={3} />
        </Field>
        <Field label="Unit">
          <input value={form.priceUnit} onChange={(e) => set({ priceUnit: e.target.value })} style={inputStyle} placeholder={SHOP_UNIT_DEFAULT} />
        </Field>
      </TwoUp>
      <TwoUp>
        {/* "units", not "cards": the catalogue sells scanners and screens too,
            and a label that says cards makes the field look inapplicable on
            two thirds of the shelves.

            The placeholder is the real floor now. It used to read 50, which
            was never the floor and — being only a placeholder — was never
            stored either, so a piece saved without touching this field had no
            minimum at all. The server now falls back to the same constant. */}
        <Field label="Minimum order (units)">
          <input
            type="number"
            min={1}
            value={form.minOrderQty}
            onChange={(e) => set({ minOrderQty: e.target.value })}
            style={inputStyle}
            placeholder={String(SHOP_MIN_ORDER_QTY)}
          />
        </Field>
        <Field label="Lead time (blank uses the section default)">
          <input value={form.leadTimeText} onChange={(e) => set({ leadTimeText: e.target.value })} style={inputStyle} placeholder="Standard production lead time: 3–4 weeks" />
        </Field>
      </TwoUp>

      <SectionLabel>Filing</SectionLabel>
      <Field label="Collection">
        <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} style={inputStyle}>
          <option value="">— none —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Labels">
        {badges.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.text400, margin: 0 }}>
            No labels yet — create them on the Labels tab (that is where &ldquo;New&rdquo; comes from).
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {badges.map((b) => {
              const on = form.badgeIds.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => set({
                    badgeIds: on ? form.badgeIds.filter((x) => x !== b.id) : [...form.badgeIds, b.id],
                  })}
                  style={{
                    minHeight: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, letterSpacing: '.04em',
                    border: `1px solid ${on ? b.bg_color : T.border}`,
                    background: on ? b.bg_color : T.surface,
                    color: on ? b.text_color : T.text500,
                  }}
                  aria-pressed={on}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <SectionLabel>Selling points</SectionLabel>
      <ListEditor
        items={form.highlights}
        onChange={(highlights) => set({ highlights })}
        placeholder="e.g. Gold foil stamping"
        addLabel="+ Add selling point"
        manage={manage}
      />

      <SectionLabel>Specification</SectionLabel>
      <SpecEditor specs={form.specs} onChange={(specs) => set({ specs })} manage={manage} />

      <SectionLabel>Ordering &amp; visibility</SectionLabel>
      <Field label="WhatsApp message for this piece (blank uses the section greeting)">
        <textarea
          value={form.whatsappMessage}
          onChange={(e) => set({ whatsappMessage: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="Hello! I would like to order the Velvet & Gold suite."
        />
      </Field>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <Check label="Published (visible on the site)" checked={form.isPublished} onChange={(v) => set({ isPublished: v })} />
        <Check label="Featured (leads the homepage teaser)" checked={form.isFeatured} onChange={(v) => set({ isFeatured: v })} />
        <Check label="Sold out" checked={form.isSoldOut} onChange={(v) => set({ isSoldOut: v })} />
      </div>

      <SectionLabel>Search listing</SectionLabel>
      <Field label="Meta title">
        <input value={form.metaTitle} onChange={(e) => set({ metaTitle: e.target.value })} style={inputStyle} placeholder="Defaults to the title" />
      </Field>
      <Field label="Meta description">
        <textarea value={form.metaDescription} onChange={(e) => set({ metaDescription: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Defaults to the tagline" />
      </Field>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Collections
   ═══════════════════════════════════════════════════════════════════════ */

function CategoriesTab() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CATEGORY);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/shop/categories');
        if (!ignore) setRows(res?.categories || []);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const save = async () => {
    if (!form.name.trim()) { showAlert('A name is required.', 'Missing name', 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug || undefined,
        description: form.description,
        /* Sent even when empty, and that is the point: '' is how "Remove
           cover" reaches the PATCH, which clears the column. Omitting the key
           would mean "leave it alone" and the removal would silently no-op. */
        coverImageUrl: form.coverImageUrl,
        coverImageAlt: form.coverImageAlt,
        sortOrder: form.sortOrder,
        isPublished: form.isPublished,
      };
      if (editing) await adminApi.patch(`/shop/categories/${editing.id}`, payload);
      else await adminApi.post('/shop/categories', payload);
      setOpen(false);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to save.', 'Error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await showConfirm(
      `Delete the "${row.name}" collection? Pieces in it stay on sale and simply become uncategorised.`,
      'Delete collection',
    );
    if (!ok) return;
    try {
      await adminApi.del(`/shop/categories/${row.id}`);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to delete.', 'Error', 'error');
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div style={{ ...card, padding: '14px 18px', marginBottom: 16, fontSize: 12.5, color: T.text500, lineHeight: 1.7 }}>
        Collections are how the public catalogue is browsed — the plates on /shop, the index inside a
        collection, and the Collections group in the filter. A collection with no published piece in it
        is hidden automatically, so an empty one can never appear.
        <br />
        <strong style={{ color: T.text700 }}>Give each one a cover photograph.</strong> It is the picture
        that stands for the whole shelf in all three places, so use an editorial shot — a styled scene,
        a texture, a table set — not a photo of a single product. A collection with no cover falls back
        to a drawn plate rather than borrowing one of its product photos.
      </div>

      <DataTable
        title={`Collections (${rows.length})`}
        rows={rows}
        rowKey={(r) => r.id}
        emptyText="No collections yet."
        onRefresh={load}
        actions={manage ? <Button variant="primary" onClick={() => { setEditing(null); setForm(EMPTY_CATEGORY); setOpen(true); }}>Add collection</Button> : null}
        columns={[
          {
            key: 'name',
            header: 'Collection',
            render: (r) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* The cover, at the size it is judged: a collection with none
                    shows the placeholder here, which is the fastest way to see
                    which shelves are still unstyled. */}
                <Thumb src={r.cover_image_url} size={44} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: T.text900, fontSize: 13 }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: T.text500 }}>/{r.slug}</div>
                  {!r.cover_image_url && (
                    <div style={{ fontSize: 11, color: T.text400, marginTop: 2 }}>No cover — shows the drawn plate</div>
                  )}
                </div>
              </div>
            ),
          },
          { key: 'sort', header: 'Order', render: (r) => <span style={{ fontSize: 12.5 }}>{r.sort_order}</span> },
          {
            key: 'state',
            header: 'Live',
            render: (r) => (
              <span style={{ fontSize: 11, fontWeight: 700, color: r.is_published ? T.successDark : T.text400 }}>
                {r.is_published ? 'LIVE' : 'HIDDEN'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button variant="ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => {
                  setEditing(r);
                  setForm({
                    name: r.name || '', slug: r.slug || '', description: r.description || '',
                    coverImageUrl: r.cover_image_url || '', coverImageAlt: r.cover_image_alt || '',
                    sortOrder: String(r.sort_order ?? 0), isPublished: !!r.is_published,
                  });
                  setOpen(true);
                }}>{manage ? 'Edit' : 'View'}</Button>
                {manage && <Button variant="danger" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => remove(r)}>Delete</Button>}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add collection'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {manage && <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
          </>
        )}
      >
        <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="e.g. Wedding" /></Field>
        <Field label="URL slug (optional)"><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} style={inputStyle} placeholder="wedding" /></Field>
        <Field label="Description (internal)"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} /></Field>

        <CategoryCoverField form={form} setForm={setForm} disabled={!manage} />

        <Field label="Sort order"><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} style={inputStyle} /></Field>
        <Check label="Published" checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} />
      </Modal>
    </>
  );
}


/**
 * The collection's cover photograph.
 *
 * Deliberately its own control rather than a row in the product image list:
 * this picture is not one of the pieces. It stands for the whole shelf on
 * three public surfaces — the plates on /shop, the index strip inside a
 * collection, and the Collections group in the filter — so it is judged at
 * three sizes at once, and the preview here is the widest of them.
 *
 * It reuses makeImageUploadHandler for the same reason every other admin
 * upload does: the fallback. When the 'event-assets' bucket is unreachable the
 * file is embedded as a base64 data: URI instead of failing, and a second copy
 * of that logic would fail differently on this screen than on the others.
 */
function CategoryCoverField({ form, setForm, disabled }) {
  const { showAlert } = useAlert();
  const [uploading, setUploading] = useState(false);

  const upload = makeImageUploadHandler({
    kind: 'shop-category',
    setField: (url) => setForm((f) => ({ ...f, coverImageUrl: url })),
    setUploading,
    showAlert,
  });

  return (
    <Field label="Cover photograph">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* 16:10, which is the plate's own crop. A square preview here made a
            landscape shot look safe and then cut its subject out on /shop. */}
        <div
          style={{
            width: 168, height: 105, flexShrink: 0, borderRadius: 8, overflow: 'hidden',
            border: `1px solid ${T.border}`, background: T.surfaceAlt,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: T.text400, fontSize: 11.5, textAlign: 'center', padding: 8,
          }}
        >
          {form.coverImageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={form.coverImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span>No cover yet —<br />the drawn plate is used</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label
              style={{
                ...inputStyle, width: 'auto', padding: '9px 16px', fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: disabled || uploading ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {uploading ? 'Uploading…' : form.coverImageUrl ? 'Replace' : 'Upload cover'}
              <input
                type="file"
                accept="image/*"
                onChange={upload}
                disabled={disabled || uploading}
                style={{ display: 'none' }}
              />
            </label>
            {form.coverImageUrl && !disabled && (
              <Button
                variant="ghost"
                style={{ padding: '9px 14px', fontSize: 12 }}
                onClick={() => setForm((f) => ({ ...f, coverImageUrl: '', coverImageAlt: '' }))}
              >
                Remove
              </Button>
            )}
          </div>

          <input
            value={form.coverImageAlt}
            onChange={(e) => setForm((f) => ({ ...f, coverImageAlt: e.target.value }))}
            disabled={disabled}
            style={{ ...inputStyle, marginTop: 8 }}
            placeholder="Alt text (optional) — describe the picture, not the collection"
          />
          <div style={{ fontSize: 11.5, color: T.text500, marginTop: 6, lineHeight: 1.6 }}>
            {/* The name is printed in type right beside the photograph on every
                surface, so an alt that repeats it is read twice. Leaving this
                blank marks the image decorative, which is the correct answer
                for most covers. */}
            An editorial shot, not a product photo. Landscape, at least 1200px wide.
            Leave the alt blank if the picture is decorative — the collection name is
            already read out next to it.
          </div>
        </div>
      </div>
    </Field>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Labels — the "New" requirement
   ═══════════════════════════════════════════════════════════════════════ */

function BadgesTab() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_BADGE);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/shop/badges');
        if (!ignore) setRows(res?.badges || []);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const save = async () => {
    if (!form.label.trim()) { showAlert('A label is required.', 'Missing label', 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        label: form.label,
        bgColor: form.bgColor,
        textColor: form.textColor,
        isFilterable: form.isFilterable,
        sortOrder: form.sortOrder,
        isPublished: form.isPublished,
      };
      if (editing) await adminApi.patch(`/shop/badges/${editing.id}`, payload);
      else await adminApi.post('/shop/badges', payload);
      setOpen(false);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to save.', 'Error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await showConfirm(
      `Delete the "${row.label}" label? It is removed from every piece carrying it. The pieces themselves are untouched.`,
      'Delete label',
    );
    if (!ok) return;
    try {
      await adminApi.del(`/shop/badges/${row.id}`);
      await load();
    } catch (err) {
      showAlert(err?.message || 'Failed to delete.', 'Error', 'error');
    }
  };

  if (loading) return <PageLoading />;

  return (
    <>
      <div style={{ ...card, padding: '14px 18px', marginBottom: 16, fontSize: 12.5, color: T.text500, lineHeight: 1.7 }}>
        A label is the ribbon on the corner of a card — <strong style={{ color: T.text900 }}>&ldquo;New&rdquo;</strong>,
        &ldquo;Best seller&rdquo;, anything you type. Mark it <em>filterable</em> and it also becomes a filter chip
        visitors can browse by. Unpublish it and it disappears from every piece at once.
      </div>

      <DataTable
        title={`Labels (${rows.length})`}
        rows={rows}
        rowKey={(r) => r.id}
        emptyText='No labels yet. "New" is a good first one.'
        onRefresh={load}
        actions={manage ? <Button variant="primary" onClick={() => { setEditing(null); setForm(EMPTY_BADGE); setOpen(true); }}>Add label</Button> : null}
        columns={[
          {
            key: 'label',
            header: 'Label',
            render: (r) => (
              <span style={{ background: r.bg_color, color: r.text_color, fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 4, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                {r.label}
              </span>
            ),
          },
          {
            key: 'filter',
            header: 'Filter chip',
            render: (r) => <span style={{ fontSize: 12, color: r.is_filterable ? T.text900 : T.text400 }}>{r.is_filterable ? 'Yes' : 'No'}</span>,
          },
          { key: 'sort', header: 'Order', render: (r) => <span style={{ fontSize: 12.5 }}>{r.sort_order}</span> },
          {
            key: 'state',
            header: 'Live',
            render: (r) => (
              <span style={{ fontSize: 11, fontWeight: 700, color: r.is_published ? T.successDark : T.text400 }}>
                {r.is_published ? 'LIVE' : 'HIDDEN'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button variant="ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => {
                  setEditing(r);
                  setForm({
                    label: r.label || '', bgColor: r.bg_color || '#8A6D34', textColor: r.text_color || '#FFFFFF',
                    isFilterable: !!r.is_filterable, sortOrder: String(r.sort_order ?? 0), isPublished: !!r.is_published,
                  });
                  setOpen(true);
                }}>{manage ? 'Edit' : 'View'}</Button>
                {manage && <Button variant="danger" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => remove(r)}>Delete</Button>}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit — ${editing.label}` : 'Add label'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {manage && <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
          </>
        )}
      >
        <Field label="Text"><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={inputStyle} placeholder="New" maxLength={40} /></Field>
        <TwoUp>
          <Field label="Background">
            <ColorInput value={form.bgColor} onChange={(v) => setForm({ ...form, bgColor: v })} />
          </Field>
          <Field label="Text colour">
            <ColorInput value={form.textColor} onChange={(v) => setForm({ ...form, textColor: v })} />
          </Field>
        </TwoUp>

        <div style={{ margin: '14px 0 18px' }}>
          <span style={{ display: 'block', fontSize: 11, color: T.text500, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Preview</span>
          <span style={{ background: form.bgColor, color: form.textColor, fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 4, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            {form.label || 'Label'}
          </span>
        </div>

        <Field label="Sort order"><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} style={inputStyle} /></Field>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
          <Check label="Show as a filter chip" checked={form.isFilterable} onChange={(v) => setForm({ ...form, isFilterable: v })} />
          <Check label="Published" checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} />
        </div>
      </Modal>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════════ */

function SettingsTab() {
  const { showAlert } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await adminApi.get('/shop/settings');
        if (!ignore) setForm(res?.settings || null);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.patch('/shop/settings', {
        enabled: form.enabled,
        showOnHomepage: form.show_on_homepage,
        showInDashboard: form.show_in_dashboard,
        whatsappNumber: form.whatsapp_number,
        whatsappGreeting: form.whatsapp_greeting,
        heroKicker: form.hero_kicker,
        heroTitle: form.hero_title,
        heroSubtitle: form.hero_subtitle,
        defaultLeadTime: form.default_lead_time,
        defaultSort: form.default_sort,
      });
      setForm(res?.settings || form);
      showAlert('Settings saved.', 'Saved', 'success');
    } catch (err) {
      showAlert(err?.message || 'Failed to save settings.', 'Error', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!form) return null;

  const set = (patch) => setForm({ ...form, ...patch });
  const digits = String(form.whatsapp_number || '').replace(/\D/g, '');

  return (
    <div style={{ ...card, padding: 'clamp(16px, 3vw, 26px)', maxWidth: 760 }}>
      <SectionLabel>Where it appears</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
        <Check label={`Section enabled — turning this off makes ${SHOP_PATH} return Not Found`} checked={form.enabled !== false} onChange={(v) => set({ enabled: v })} />
        <Check label="Show the teaser band on the homepage" checked={form.show_on_homepage !== false} onChange={(v) => set({ show_on_homepage: v })} />
        <Check label="Show the offer card in the organizer dashboard" checked={form.show_in_dashboard !== false} onChange={(v) => set({ show_in_dashboard: v })} />
      </div>

      <SectionLabel>How people order</SectionLabel>
      <Field label="WhatsApp number (country code first — digits only, punctuation is stripped)">
        <input value={form.whatsapp_number || ''} onChange={(e) => set({ whatsapp_number: e.target.value })} style={inputStyle} placeholder="19055550134" inputMode="tel" />
      </Field>
      {!digits && (
        <p style={{ fontSize: 12.5, color: T.warningDark, margin: '0 0 12px', lineHeight: 1.6 }}>
          Without a number there is nothing to order through, so every &ldquo;Order on WhatsApp&rdquo; button is
          hidden and the product page falls back to the contact form. The catalogue stays visible.
        </p>
      )}
      <Field label="Default message a customer sends">
        <textarea value={form.whatsapp_greeting || ''} onChange={(e) => set({ whatsapp_greeting: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      </Field>
      <p style={{ fontSize: 12, color: T.text500, margin: '0 0 12px', lineHeight: 1.6 }}>
        The piece&apos;s name and its page link are appended automatically, so whoever answers knows what is meant.
      </p>

      <SectionLabel>Page copy</SectionLabel>
      <Field label="Kicker"><input value={form.hero_kicker || ''} onChange={(e) => set({ hero_kicker: e.target.value })} style={inputStyle} /></Field>
      <Field label="Title"><input value={form.hero_title || ''} onChange={(e) => set({ hero_title: e.target.value })} style={inputStyle} /></Field>
      <Field label="Subtitle"><textarea value={form.hero_subtitle || ''} onChange={(e) => set({ hero_subtitle: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></Field>
      <Field label="Default lead time (used by any piece that does not set its own)">
        <input value={form.default_lead_time || ''} onChange={(e) => set({ default_lead_time: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Default sort on the catalogue">
        <select value={form.default_sort || 'manual'} onChange={(e) => set({ default_sort: e.target.value })} style={inputStyle}>
          <option value="manual">Featured — the order you arranged on the Products tab</option>
          <option value="newest">Newest first</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </Field>

      {manage && (
        <div style={{ marginTop: 20 }}>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Interest
   ═══════════════════════════════════════════════════════════════════════ */

function InquiriesTab() {
  const { showAlert } = useAlert();
  const [data, setData] = useState({ summary: [], inquiries: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/shop/inquiries');
        if (!ignore) {
          setData({ summary: res?.summary || [], inquiries: res?.inquiries || [], total: res?.total || 0 });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  if (loading) return <PageLoading />;

  return (
    <>
      <div style={{ ...card, padding: '14px 18px', marginBottom: 16, fontSize: 12.5, color: T.text500, lineHeight: 1.7 }}>
        Every tap on an &ldquo;Order on WhatsApp&rdquo; button, counted here. The conversation itself happens off
        the platform, so this is the only place the funnel is visible — pair it with the views column on the
        Products tab to see which pieces get looked at but never asked about.
      </div>

      <DataTable
        title={`Most asked about (${data.total} taps recorded)`}
        rows={data.summary}
        rowKey={(r, i) => r.productId || `deleted-${i}`}
        emptyText="No WhatsApp taps recorded yet."
        onRefresh={load}
        columns={[
          { key: 'title', header: 'Piece', render: (r) => <span style={{ fontWeight: 700, fontSize: 13, color: T.text900 }}>{r.title}</span> },
          { key: 'count', header: 'Taps', render: (r) => <span style={{ fontWeight: 700, fontSize: 13 }}>{r.count}</span> },
          {
            key: 'last',
            header: 'Most recent',
            render: (r) => <span style={{ fontSize: 12.5, color: T.text500 }}>{r.lastAt ? adminTime(r.lastAt) : '—'}</span>,
          },
        ]}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Small shared pieces
   ═══════════════════════════════════════════════════════════════════════ */

function SectionLabel({ children }) {
  return (
    <h3 style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
      color: T.primaryDark, margin: '22px 0 12px', paddingBottom: 8, borderBottom: `1px solid ${T.border}`,
    }}>
      {children}
    </h3>
  );
}

/* auto-fit rather than two fixed columns: a pair of 50% tracks becomes two
   unusable 130px fields inside a modal on a phone. */
function TwoUp({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
      {children}
    </div>
  );
}

function Thumb({ src, size = 40 }) {
  if (!src) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size, height: size, flexShrink: 0, borderRadius: 6, background: T.surfaceAlt,
          border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.text400, fontSize: 11, fontFamily: 'var(--font-script)',
        }}
      >
        F
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, flexShrink: 0, borderRadius: 6, objectFit: 'cover', border: `1px solid ${T.border}` }}
    />
  );
}

function IconBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 30, height: 30, borderRadius: 6, border: `1px solid ${T.border}`,
        background: T.surface, color: disabled ? T.text400 : T.text700,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        fontSize: 14, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.text700, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: T.primary, cursor: 'pointer' }} />
      {label}
    </label>
  );
}

/** Native swatch beside a text field — the swatch alone hides the hex value. */
function ColorInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#8A6D34'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 44, height: 38, padding: 2, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, background: T.surface, cursor: 'pointer', flexShrink: 0 }}
        aria-label="Pick a colour"
      />
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, minWidth: 0 }} placeholder="#8A6D34" />
    </div>
  );
}

/** Repeatable single-line list — the selling points. */
function ListEditor({ items, onChange, placeholder, addLabel, manage }) {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              style={{ ...inputStyle, minWidth: 0 }}
              placeholder={placeholder}
            />
            {manage && <IconBtn label="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}>×</IconBtn>}
          </div>
        ))}
      </div>
      {manage && (
        <Button variant="ghost" onClick={() => onChange([...items, ''])} style={{ marginTop: 8, padding: '6px 12px', fontSize: 12 }}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}

/** Repeatable label/value rows — the specification table. */
function SpecEditor({ specs, onChange, manage }) {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {specs.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={row.label || ''}
              onChange={(e) => {
                const next = [...specs];
                next[i] = { ...next[i], label: e.target.value };
                onChange(next);
              }}
              style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }}
              placeholder="Material"
            />
            <input
              value={row.value || ''}
              onChange={(e) => {
                const next = [...specs];
                next[i] = { ...next[i], value: e.target.value };
                onChange(next);
              }}
              style={{ ...inputStyle, flex: '2 1 200px', minWidth: 0 }}
              placeholder="350gsm cotton board"
            />
            {manage && <IconBtn label="Remove" onClick={() => onChange(specs.filter((_, k) => k !== i))}>×</IconBtn>}
          </div>
        ))}
      </div>
      {manage && (
        <Button variant="ghost" onClick={() => onChange([...specs, { label: '', value: '' }])} style={{ marginTop: 8, padding: '6px 12px', fontSize: 12 }}>
          + Add specification row
        </Button>
      )}
      <p style={{ fontSize: 11.5, color: T.text400, margin: '8px 0 0' }}>
        Rows with an empty side are dropped when saved — a half-filled row renders as a dangling label.
      </p>
    </div>
  );
}
