'use client';

import { useCallback, useEffect, useState } from 'react';
import adminApi from '../../_lib/adminApi';
import usePermissions from '../../_hooks/usePermissions';
import DataTable from '../../_components/DataTable';
import { PageLoading } from '../../_components/Spinner';
import Modal, { Button } from '../../_components/Modal';
import { T, card } from '../../_components/theme';
import { useAlert } from '../../_components/AlertContext';
import { Field } from '../../_components/Field';
// Shared with admin/(panel)/shop — see admin/_lib/uploadImage.js. It used to be
// a private helper in this file; a second screen needed the identical storage +
// base64-fallback behaviour, and two copies of a fallback fail differently.
import { makeImageUploadHandler } from '../../_lib/uploadImage';

/**
 * Landing CMS — real, admin-managed testimonials + "As Seen In" press
 * mentions (replacing three testimonials that were once fabricated and
 * hard-coded, and adding press-logo trust badges that were never surfaced on
 * the landing page at all). Full CRUD for both; the public landing page only
 * ever reads published rows via GET /public/testimonials and
 * GET /public/press-mentions.
 *
 * Both now render in ONE homepage band — components/landing/ProofSection.js,
 * which merged the former PressBar and TestimonialsSection. It renders
 * nothing at all while both lists are empty, so publishing the first row here
 * is what makes that section appear on the homepage.
 */

const EMPTY_TESTIMONIAL_FORM = {
  name: '', role: '', quote: '', photoUrl: '', initials: '',
  rating: '5', verifyUrl: '', isPublished: true, sortOrder: '0',
};

const EMPTY_PRESS_FORM = {
  publicationName: '', logoUrl: '', articleUrl: '', headline: '', isPublished: true, sortOrder: '0',
};

const EMPTY_BLOG_FORM = {
  title: '', slug: '', excerpt: '', content: '', coverImageUrl: '', category: '', authorName: '',
  isPublished: false, metaTitle: '', metaDescription: '',
};

function deriveInitials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function StarPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill={n <= value ? T.primary : 'none'} stroke={T.primary} strokeWidth="1">
            <path d="M8 0.5L9.79 5.81L15.5 6.19L11.09 9.94L12.54 15.5L8 12.4L3.46 15.5L4.91 9.94L0.5 6.19L6.21 5.81L8 0.5Z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export default function CmsPage() {
  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>Landing CMS</h1>
        <p style={{ fontSize: 13, color: T.text500, margin: '4px 0 0' }}>Manage the real customer testimonials and press mentions shown on the landing page.</p>
      </header>
      <Testimonials />
      <div style={{ height: 28 }} />
      <PressMentions />
      <div style={{ height: 28 }} />
      <BlogPosts />
    </div>
  );
}

function Testimonials() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [editing, setEditing] = useState(null); // row or 'new'
  const [form, setForm] = useState(EMPTY_TESTIMONIAL_FORM);
  const [busy, setBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/testimonials');
        if (!ignore) { setRows(res?.testimonials || []); setError(null); }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load testimonials');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const openNew = () => { setForm(EMPTY_TESTIMONIAL_FORM); setEditing('new'); };
  const openEdit = (t) => {
    setForm({
      name: t.name, role: t.role || '', quote: t.quote,
      photoUrl: t.photo_url || '', initials: t.initials || '',
      rating: String(t.rating), verifyUrl: t.verify_url || '',
      isPublished: t.is_published, sortOrder: String(t.sort_order || 0),
    });
    setEditing(t);
  };

  const handlePhotoUpload = makeImageUploadHandler({
    kind: 'testimonial',
    setField: (url) => setForm((prev) => ({ ...prev, photoUrl: url })),
    setUploading: setPhotoUploading,
    showAlert,
  });

  const save = async () => {
    if (!form.name.trim()) { showAlert('Name is required.', 'Validation Error', 'warning'); return; }
    if (!form.quote.trim()) { showAlert('Quote is required.', 'Validation Error', 'warning'); return; }
    const payload = {
      name: form.name.trim(),
      role: form.role.trim() || null,
      quote: form.quote.trim(),
      photoUrl: form.photoUrl.trim() || null,
      initials: (form.initials.trim() || deriveInitials(form.name)) || null,
      rating: parseInt(form.rating, 10) || 5,
      verifyUrl: form.verifyUrl.trim() || null,
      isPublished: form.isPublished,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
    };
    setBusy(true);
    try {
      if (editing === 'new') await adminApi.post('/testimonials', payload);
      else await adminApi.patch(`/testimonials/${editing.id}`, payload);
      setEditing(null);
      reload();
    } catch (err) {
      showAlert(err.message || 'Save failed', 'Error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (t) => {
    try { await adminApi.patch(`/testimonials/${t.id}`, { isPublished: !t.is_published }); reload(); }
    catch (err) { showAlert(err.message || 'Update failed', 'Error', 'error'); }
  };

  const remove = async (t) => {
    if (!await showConfirm(`Delete the testimonial from "${t.name}"? This cannot be undone.`, 'Delete Testimonial', 'danger')) return;
    try { await adminApi.del(`/testimonials/${t.id}`); reload(); }
    catch (err) { showAlert(err.message || 'Delete failed', 'Error', 'error'); }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text900, margin: 0 }}>Testimonials</h2>
        {manage && <Button variant="primary" onClick={openNew}>+ New testimonial</Button>}
      </div>

      <div style={{ ...card, padding: '10px 14px', marginBottom: 14, background: T.primarySoft, fontSize: 12, color: T.text700 }}>
        Only <strong>Published</strong> testimonials appear on the landing page, in the order shown here (lowest sort order first). Add a <strong>Verify link</strong> (Google review, LinkedIn post, etc.) whenever possible — it&apos;s shown to visitors as a clickable credibility link.
      </div>

      {error && <p style={{ color: T.danger }}>{error}</p>}
      {loading ? (
        <PageLoading label="Loading testimonials…" />
      ) : (
        <DataTable
          rows={rows}
          loading={loading}
          onRefresh={reload}
          emptyText="No testimonials yet. Add your first real customer review above."
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'avatar', header: '', render: (r) => (
                r.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photo_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#B8944F,#D7BE80)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                    {r.initials || deriveInitials(r.name)}
                  </div>
                )
              ),
            },
            {
              key: 'name', header: 'Customer', render: (r) => (
                <div>
                  <div style={{ fontWeight: 700, color: T.text900 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: T.text400 }}>{r.role || '—'}</div>
                </div>
              ),
            },
            { key: 'quote', header: 'Quote', render: (r) => <span style={{ display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.quote}</span> },
            { key: 'rating', header: 'Rating', render: (r) => '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) },
            { key: 'verify_url', header: 'Verified', render: (r) => r.verify_url ? <a href={r.verify_url} target="_blank" rel="noopener noreferrer" style={{ color: T.primary, fontWeight: 700, textDecoration: 'none' }}>Link ↗</a> : '—' },
            {
              key: 'is_published', header: 'Status', render: (r) => (
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
                  background: r.is_published ? T.successSoft : T.surfaceAlt,
                  color: r.is_published ? T.successDark : T.text400,
                  border: `1px solid ${r.is_published ? 'rgba(16,185,129,0.2)' : T.border}`,
                }}>
                  {r.is_published ? 'Published' : 'Draft'}
                </span>
              ),
            },
            ...(manage ? [{
              key: 'actions', header: '', align: 'right', render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                  <Button variant="ghost" onClick={() => togglePublished(r)}>{r.is_published ? 'Unpublish' : 'Publish'}</Button>
                  <Button variant="danger" onClick={() => remove(r)}>Delete</Button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New testimonial' : 'Edit testimonial'}
        onClose={() => setEditing(null)}
        width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}
      >
        <div className="tst-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="Full name" /></Field>
          <Field label="Role / context"><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle} placeholder="e.g. Wedding · June 2025" /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Quote">
            <textarea value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} rows={4} style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }} placeholder="The real review, in the customer's own words." />
          </Field>
        </div>

        <div className="tst-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Initials (auto-filled from name if left blank)">
            <input value={form.initials} onChange={(e) => setForm({ ...form, initials: e.target.value })} style={inputStyle} placeholder={deriveInitials(form.name) || 'e.g. JD'} maxLength={4} />
          </Field>
          <Field label="Rating">
            <StarPicker value={parseInt(form.rating, 10) || 5} onChange={(n) => setForm({ ...form, rating: String(n) })} />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Real customer photo (optional — falls back to initials)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {form.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.photoUrl} alt="Preview" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: `1px solid ${T.border}` }} />
              )}
              <label style={{ ...inputStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: photoUploading ? 'wait' : 'pointer', width: 'auto', padding: '9px 16px' }}>
                {photoUploading ? 'Uploading…' : form.photoUrl ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/*" disabled={photoUploading} onChange={handlePhotoUpload} style={{ display: 'none' }} />
              </label>
              {form.photoUrl && !photoUploading && (
                <Button variant="ghost" onClick={() => setForm({ ...form, photoUrl: '' })}>Remove</Button>
              )}
            </div>
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Verify link (Google review, LinkedIn, case study — increases credibility)">
            <input value={form.verifyUrl} onChange={(e) => setForm({ ...form, verifyUrl: e.target.value })} style={inputStyle} placeholder="https://..." />
          </Field>
        </div>

        <div className="tst-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Sort order (lower shows first)">
            <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} style={inputStyle} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, fontSize: 13, color: T.text700, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
            Published (visible on the landing page)
          </label>
        </div>

        <style jsx>{`
          @media (max-width: 639.98px) {
            .tst-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </Modal>
    </section>
  );
}

function PressMentions() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [editing, setEditing] = useState(null); // row or 'new'
  const [form, setForm] = useState(EMPTY_PRESS_FORM);
  const [busy, setBusy] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/press-mentions');
        if (!ignore) { setRows(res?.pressMentions || []); setError(null); }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load press mentions');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const openNew = () => { setForm(EMPTY_PRESS_FORM); setEditing('new'); };
  const openEdit = (p) => {
    setForm({
      publicationName: p.publication_name, logoUrl: p.logo_url || '',
      articleUrl: p.article_url || '', headline: p.headline || '',
      isPublished: p.is_published, sortOrder: String(p.sort_order || 0),
    });
    setEditing(p);
  };

  const handleLogoUpload = makeImageUploadHandler({
    kind: 'press-logo',
    setField: (url) => setForm((prev) => ({ ...prev, logoUrl: url })),
    setUploading: setLogoUploading,
    showAlert,
  });

  const save = async () => {
    if (!form.publicationName.trim()) { showAlert('Publication name is required.', 'Validation Error', 'warning'); return; }
    const payload = {
      publicationName: form.publicationName.trim(),
      logoUrl: form.logoUrl.trim() || null,
      articleUrl: form.articleUrl.trim() || null,
      headline: form.headline.trim() || null,
      isPublished: form.isPublished,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
    };
    setBusy(true);
    try {
      if (editing === 'new') await adminApi.post('/press-mentions', payload);
      else await adminApi.patch(`/press-mentions/${editing.id}`, payload);
      setEditing(null);
      reload();
    } catch (err) {
      showAlert(err.message || 'Save failed', 'Error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (p) => {
    try { await adminApi.patch(`/press-mentions/${p.id}`, { isPublished: !p.is_published }); reload(); }
    catch (err) { showAlert(err.message || 'Update failed', 'Error', 'error'); }
  };

  const remove = async (p) => {
    if (!await showConfirm(`Delete the press mention for "${p.publication_name}"? This cannot be undone.`, 'Delete Press Mention', 'danger')) return;
    try { await adminApi.del(`/press-mentions/${p.id}`); reload(); }
    catch (err) { showAlert(err.message || 'Delete failed', 'Error', 'error'); }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text900, margin: 0 }}>Press Mentions / &quot;As Seen In&quot;</h2>
        {manage && <Button variant="primary" onClick={openNew}>+ New press mention</Button>}
      </div>

      <div style={{ ...card, padding: '10px 14px', marginBottom: 14, background: T.primarySoft, fontSize: 12, color: T.text700 }}>
        Shown as a trust-badge strip near the landing page hero. Only add a publication that has <strong>actually</strong> covered or mentioned this product — link the real article via <strong>Article URL</strong> whenever possible. This section is hidden entirely on the landing page until at least one row is published here.
      </div>

      {error && <p style={{ color: T.danger }}>{error}</p>}
      {loading ? (
        <PageLoading label="Loading press mentions…" />
      ) : (
        <DataTable
          rows={rows}
          loading={loading}
          onRefresh={reload}
          emptyText="No press mentions yet. Add a real one above once this product has actually been covered somewhere."
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'logo', header: '', render: (r) => (
                r.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.logo_url} alt="" style={{ height: 24, maxWidth: 90, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 11, color: T.text400, fontStyle: 'italic' }}>No logo</span>
                )
              ),
            },
            {
              key: 'publication_name', header: 'Publication', render: (r) => (
                <div>
                  <div style={{ fontWeight: 700, color: T.text900 }}>{r.publication_name}</div>
                  <div style={{ fontSize: 11, color: T.text400, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.headline || '—'}</div>
                </div>
              ),
            },
            { key: 'article_url', header: 'Article', render: (r) => r.article_url ? <a href={r.article_url} target="_blank" rel="noopener noreferrer" style={{ color: T.primary, fontWeight: 700, textDecoration: 'none' }}>Link ↗</a> : '—' },
            {
              key: 'is_published', header: 'Status', render: (r) => (
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
                  background: r.is_published ? T.successSoft : T.surfaceAlt,
                  color: r.is_published ? T.successDark : T.text400,
                  border: `1px solid ${r.is_published ? 'rgba(16,185,129,0.2)' : T.border}`,
                }}>
                  {r.is_published ? 'Published' : 'Draft'}
                </span>
              ),
            },
            ...(manage ? [{
              key: 'actions', header: '', align: 'right', render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                  <Button variant="ghost" onClick={() => togglePublished(r)}>{r.is_published ? 'Unpublish' : 'Publish'}</Button>
                  <Button variant="danger" onClick={() => remove(r)}>Delete</Button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New press mention' : 'Edit press mention'}
        onClose={() => setEditing(null)}
        width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}
      >
        <Field label="Publication name">
          <input value={form.publicationName} onChange={(e) => setForm({ ...form, publicationName: e.target.value })} style={inputStyle} placeholder="e.g. The Knot" />
        </Field>

        <div style={{ marginTop: 12 }}>
          <Field label="Logo (optional — falls back to the publication name as text)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {form.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoUrl} alt="Preview" style={{ height: 32, maxWidth: 120, objectFit: 'contain' }} />
              )}
              <label style={{ ...inputStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: logoUploading ? 'wait' : 'pointer', width: 'auto', padding: '9px 16px' }}>
                {logoUploading ? 'Uploading…' : form.logoUrl ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/*" disabled={logoUploading} onChange={handleLogoUpload} style={{ display: 'none' }} />
              </label>
              {form.logoUrl && !logoUploading && (
                <Button variant="ghost" onClick={() => setForm({ ...form, logoUrl: '' })}>Remove</Button>
              )}
            </div>
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Article URL (the real, specific article/mention — recommended for credibility)">
            <input value={form.articleUrl} onChange={(e) => setForm({ ...form, articleUrl: e.target.value })} style={inputStyle} placeholder="https://..." />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Headline / quote (optional)">
            <input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} style={inputStyle} placeholder="Short quote or headline from the mention" />
          </Field>
        </div>

        <div className="prs-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Sort order (lower shows first)">
            <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} style={inputStyle} />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, fontSize: 13, color: T.text700, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
            Published (visible on the landing page)
          </label>
        </div>

        <style jsx>{`
          @media (max-width: 639.98px) {
            .prs-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </Modal>
    </section>
  );
}

function BlogPosts() {
  const { showAlert, showConfirm } = useAlert();
  const { can } = usePermissions();
  const manage = can('cms.manage');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const [editing, setEditing] = useState(null); // row or 'new'
  const [form, setForm] = useState(EMPTY_BLOG_FORM);
  const [busy, setBusy] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.get('/blog');
        if (!ignore) { setRows(res?.posts || []); setError(null); }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load blog posts');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [nonce]);

  const openNew = () => { setForm(EMPTY_BLOG_FORM); setEditing('new'); };
  const openEdit = (p) => {
    setForm({
      title: p.title, slug: p.slug, excerpt: p.excerpt || '', content: p.content,
      coverImageUrl: p.cover_image_url || '', category: p.category || '', authorName: p.author_name,
      isPublished: p.is_published, metaTitle: p.meta_title || '', metaDescription: p.meta_description || '',
    });
    setEditing(p);
  };

  const handleCoverUpload = makeImageUploadHandler({
    kind: 'blog-cover',
    setField: (url) => setForm((prev) => ({ ...prev, coverImageUrl: url })),
    setUploading: setCoverUploading,
    showAlert,
  });

  const save = async () => {
    if (!form.title.trim()) { showAlert('Title is required.', 'Validation Error', 'warning'); return; }
    if (!form.content.trim()) { showAlert('Content is required.', 'Validation Error', 'warning'); return; }
    if (!form.authorName.trim()) { showAlert('Author name is required.', 'Validation Error', 'warning'); return; }
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || undefined,
      excerpt: form.excerpt.trim() || null,
      content: form.content,
      coverImageUrl: form.coverImageUrl.trim() || null,
      category: form.category.trim() || null,
      authorName: form.authorName.trim(),
      isPublished: form.isPublished,
      metaTitle: form.metaTitle.trim() || null,
      metaDescription: form.metaDescription.trim() || null,
    };
    setBusy(true);
    try {
      if (editing === 'new') await adminApi.post('/blog', payload);
      else await adminApi.patch(`/blog/${editing.id}`, payload);
      setEditing(null);
      reload();
    } catch (err) {
      showAlert(err.message || 'Save failed', 'Error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (p) => {
    try { await adminApi.patch(`/blog/${p.id}`, { isPublished: !p.is_published }); reload(); }
    catch (err) { showAlert(err.message || 'Update failed', 'Error', 'error'); }
  };

  const remove = async (p) => {
    if (!await showConfirm(`Delete the blog post "${p.title}"? This cannot be undone.`, 'Delete Blog Post', 'danger')) return;
    try { await adminApi.del(`/blog/${p.id}`); reload(); }
    catch (err) { showAlert(err.message || 'Delete failed', 'Error', 'error'); }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text900, margin: 0 }}>Blog Posts</h2>
        {manage && <Button variant="primary" onClick={openNew}>+ New post</Button>}
      </div>

      <div style={{ ...card, padding: '10px 14px', marginBottom: 14, background: T.primarySoft, fontSize: 12, color: T.text700 }}>
        Only <strong>Published</strong> posts appear on the public blog, newest first. The <strong>slug</strong> controls the URL (<code>/blog/your-slug</code>) — leave it blank to auto-generate from the title.
      </div>

      {error && <p style={{ color: T.danger }}>{error}</p>}
      {loading ? (
        <PageLoading label="Loading blog posts…" />
      ) : (
        <DataTable
          rows={rows}
          loading={loading}
          onRefresh={reload}
          emptyText="No blog posts yet. Write your first real article above."
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'cover', header: '', render: (r) => (
                r.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.cover_image_url} alt="" style={{ width: 48, height: 36, borderRadius: 6, objectFit: 'cover', border: `1px solid ${T.border}` }} />
                ) : (
                  <div style={{ width: 48, height: 36, borderRadius: 6, background: T.surfaceAlt, border: `1px solid ${T.border}` }} />
                )
              ),
            },
            {
              key: 'title', header: 'Post', render: (r) => (
                <div>
                  <div style={{ fontWeight: 700, color: T.text900 }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: T.text400 }}>/blog/{r.slug} · {r.author_name}</div>
                </div>
              ),
            },
            { key: 'category', header: 'Category', render: (r) => r.category || '—' },
            {
              key: 'is_published', header: 'Status', render: (r) => (
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
                  background: r.is_published ? T.successSoft : T.surfaceAlt,
                  color: r.is_published ? T.successDark : T.text400,
                  border: `1px solid ${r.is_published ? 'rgba(16,185,129,0.2)' : T.border}`,
                }}>
                  {r.is_published ? 'Published' : 'Draft'}
                </span>
              ),
            },
            ...(manage ? [{
              key: 'actions', header: '', align: 'right', render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                  <Button variant="ghost" onClick={() => togglePublished(r)}>{r.is_published ? 'Unpublish' : 'Publish'}</Button>
                  <Button variant="danger" onClick={() => remove(r)}>Delete</Button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New blog post' : 'Edit blog post'}
        onClose={() => setEditing(null)}
        width={680}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}
      >
        <Field label="Title">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} placeholder="e.g. 10 Secrets to Hosting an Unforgettable Gala Evening" />
        </Field>

        <div className="blog-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="URL slug (optional — auto-generated from title)">
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} style={inputStyle} placeholder="auto" />
          </Field>
          <Field label="Category (optional)">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle} placeholder="e.g. Wedding Planning" />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Author name">
            <input value={form.authorName} onChange={(e) => setForm({ ...form, authorName: e.target.value })} style={inputStyle} placeholder="Who wrote this?" />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Excerpt (optional — shown on the blog listing card)">
            <textarea value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} placeholder="A short teaser for the article grid." />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Content — blank line = new paragraph, ## for a subheading, - for a list, **bold**, [link](https://...)">
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={12} style={{ ...inputStyle, resize: 'vertical', minHeight: 260, fontFamily: 'var(--font-mono, monospace)' }} placeholder={'## A subheading\n\nYour first paragraph goes here...\n\n- A list item\n- Another item'} />
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Cover image (optional)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {form.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.coverImageUrl} alt="Preview" style={{ width: 80, height: 50, borderRadius: 6, objectFit: 'cover', border: `1px solid ${T.border}` }} />
              )}
              <label style={{ ...inputStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: coverUploading ? 'wait' : 'pointer', width: 'auto', padding: '9px 16px' }}>
                {coverUploading ? 'Uploading…' : form.coverImageUrl ? 'Replace cover' : 'Upload cover'}
                <input type="file" accept="image/*" disabled={coverUploading} onChange={handleCoverUpload} style={{ display: 'none' }} />
              </label>
              {form.coverImageUrl && !coverUploading && (
                <Button variant="ghost" onClick={() => setForm({ ...form, coverImageUrl: '' })}>Remove</Button>
              )}
            </div>
          </Field>
        </div>

        <div className="blog-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="SEO title (optional — falls back to Title)">
            <input value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="SEO description (optional — falls back to Excerpt)">
            <input value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} style={inputStyle} />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.text700, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
            Published (visible on the public blog)
          </label>
        </div>

        <style jsx>{`
          @media (max-width: 639.98px) {
            .blog-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </Modal>
    </section>
  );
}

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
