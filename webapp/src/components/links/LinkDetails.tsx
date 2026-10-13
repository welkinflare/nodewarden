import type { LinkBookmark } from '@/lib/api/links';
import { renderLinksMarkdown } from '@/lib/links-markdown';
import { formatLinksAbsolute, formatLinksRelative } from '@/lib/links-utils';

export interface LinkDetailsPrefs {
  showFavicon: boolean;
  absoluteTime: boolean;
  linkTarget: string;
}

// linkding's HTML export packs notes onto the end of the description behind a
// "[linkding-notes]" marker. Older imports kept that raw text in `description`,
// so strip it for display to keep Description and Notes visually separate
// without needing a data migration. The real notes field is unaffected.
const LINKDING_NOTES_MARKER = '[linkding-notes]';

function cleanDescription(raw: string): { description: string; embeddedNotes: string } {
  const at = raw.indexOf(LINKDING_NOTES_MARKER);
  if (at < 0) return { description: raw, embeddedNotes: '' };
  return {
    description: raw.slice(0, at).trim(),
    embeddedNotes: raw.slice(at + LINKDING_NOTES_MARKER.length).trim(),
  };
}

function statusFlags(b: LinkBookmark): string[] {
  const flags: string[] = [];
  if (Number(b.unread) === 1) flags.push('Unread');
  if (Number(b.is_archived) === 1) flags.push('Archived');
  if (Number(b.shared) === 1) flags.push('Shared');
  return flags;
}

/**
 * Read-only detail view, mirroring linkding's "View" action: it surfaces the
 * full URL, preview, description, tags, notes and status for a single bookmark
 * without leaving the list. Mirrors the linkding details modal.
 */
export function LinkDetails({
  bookmark,
  prefs,
  onEdit,
  onDelete,
  onToggleUnread,
  onToggleShared,
  onToggleArchive,
  onClose,
}: {
  bookmark: LinkBookmark;
  prefs: LinkDetailsPrefs;
  onEdit: () => void;
  onDelete: () => void;
  onToggleUnread: () => void;
  onToggleShared: () => void;
  onToggleArchive: () => void;
  onClose: () => void;
}) {
  const tags = bookmark.tag_names ?? [];
  const { description, embeddedNotes } = cleanDescription(bookmark.description ?? '');
  // Fall back to the notes still embedded in the description for legacy imports.
  const notes = (bookmark.notes ?? '').trim() || embeddedNotes;
  const flags = statusFlags(bookmark);
  const added = prefs.absoluteTime
    ? formatLinksAbsolute(bookmark.date_added)
    : formatLinksRelative(bookmark.date_added);

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        class="card links-details"
        role="dialog"
        aria-modal="true"
        aria-label={bookmark.title || bookmark.url}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="links-details-head">
          <h2 class="links-details-title">{bookmark.title || bookmark.url}</h2>
          <button type="button" class="btn btn-secondary small" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div class="links-details-body">
          <div class="links-details-weblinks">
            <a
              class="links-details-link"
              href={bookmark.url}
              target={prefs.linkTarget || '_blank'}
              rel="noopener noreferrer"
            >
              {prefs.showFavicon && bookmark.favicon_url ? (
                <img class="links-details-favicon" src={bookmark.favicon_url} alt="" width={16} height={16} />
              ) : null}
              <span>{bookmark.url}</span>
            </a>
            {bookmark.web_archive_snapshot_url ? (
              <a
                class="links-details-link"
                href={bookmark.web_archive_snapshot_url}
                target={prefs.linkTarget || '_blank'}
                rel="noopener noreferrer"
              >
                <span>Internet Archive</span>
              </a>
            ) : null}
          </div>

          {bookmark.preview_image_url ? (
            <img
              class="links-details-preview"
              src={bookmark.preview_image_url}
              alt=""
              loading="lazy"
            />
          ) : null}

          {description ? (
            <section class="links-details-block">
              <h3 class="links-details-label">Description</h3>
              <p class="links-details-desc">{description}</p>
            </section>
          ) : null}

          {tags.length > 0 ? (
            <section class="links-details-block">
              <h3 class="links-details-label">Tags</h3>
              <div class="links-details-tags">
                {tags.map((tag) => (
                  <span key={tag} class="links-details-tag">
                    #{tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {notes ? (
            <section class="links-details-block">
              <h3 class="links-details-label">Notes</h3>
              <div
                class="links-notes links-details-notes"
                dangerouslySetInnerHTML={{ __html: renderLinksMarkdown(notes) }}
              />
            </section>
          ) : null}

          <dl class="links-details-meta">
            <div>
              <dt>Added</dt>
              <dd title={formatLinksAbsolute(bookmark.date_added)}>{added}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatLinksAbsolute(bookmark.date_modified)}</dd>
            </div>
            {flags.length > 0 ? (
              <div>
                <dt>Status</dt>
                <dd>{flags.join(' · ')}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div class="links-details-foot">
          <button type="button" class="btn btn-primary small" onClick={onEdit}>Edit</button>
          <button type="button" class="btn btn-secondary small" onClick={onToggleArchive}>
            {Number(bookmark.is_archived) === 1 ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" class="btn btn-secondary small" onClick={onToggleUnread}>
            {Number(bookmark.unread) === 1 ? 'Mark read' : 'Mark unread'}
          </button>
          <button type="button" class="btn btn-secondary small" onClick={onToggleShared}>
            {Number(bookmark.shared) === 1 ? 'Unshare' : 'Share'}
          </button>
          <span class="spacer" />
          <button type="button" class="btn btn-danger small" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}