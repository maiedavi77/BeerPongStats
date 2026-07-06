/**
 * src/ui/screens/event-gallery.js
 *
 * Event sub-view: gallery of all photos in the event (game + trichter),
 * newest first, shown as a grid with a fullscreen viewer on tap.
 */

import { eventPhotos, photoUrls } from '../../photos.js';
import { esc, shortDate } from '../../format.js';
import { openPhotoViewer } from './event-trichter.js';

export default async function render($el, ctx) {
  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading gallery…</p></div>`;

  const { photos } = await eventPhotos(ctx.eventId);

  if (!photos.length) {
    $el.innerHTML = `
      <div class="empty-state">
        <h2>No photos yet</h2>
        <p style="color:var(--text-faint); margin-top:0.5rem;">
          Add a photo after a finished game or to a trichter — they all land here.
        </p>
      </div>`;
    return;
  }

  const urls = await photoUrls(photos.map(p => p.storage_path));

  $el.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.6rem;">
      ${photos.map(p => {
        const url = urls.get(p.storage_path);
        if (!url) return '';
        return `
          <figure data-photo-url="${url}" style="margin:0; cursor:pointer;">
            <img src="${url}" alt="${esc(p.label)}" loading="lazy" style="
              width:100%; aspect-ratio:1; object-fit:cover; border-radius:12px;
              border:1px solid var(--line); display:block;" />
            <figcaption style="font-size:0.68rem; color:var(--text-faint); margin-top:0.25rem;
              white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${p.kind === 'game' ? '🎯' : '🌀'} ${esc(p.label)} · ${shortDate(p.created_at)}
            </figcaption>
          </figure>`;
      }).join('')}
    </div>`;

  $el.querySelectorAll('[data-photo-url]').forEach(fig => {
    fig.addEventListener('click', () => openPhotoViewer(fig.dataset.photoUrl));
  });
}
