import { useState } from 'preact/hooks';
import type { LinkBookmark } from '@/lib/api/links';
import { renderLinksMarkdown } from '@/lib/links-markdown';
import { displayLinksUrl, formatLinksAbsolute, formatLinksRelative, splitLinkdingNotes } from '@/lib/links-utils';

export interface LinkCardPrefs {
  showFavicon: boolean;
  showDisplayUrl: boolean;
  permanentNotes: boolean;
  absoluteTime: boolean;
  linkTarget: string;
}

// linkding-style bookmark row: title link, URL, #tags | description,
// notes box, then a text-action footer. The selection checkbox only shows
// in bulk-edit mode.
export function LinkCard({
  bookmark,
  prefs,
  bulkMode,
  selected,
  onToggle,
  onTagClick,
  onView,
  onEdit,
  onArchive,
  onDelete,
  onToggleUnread,
  onToggleShared,
}: {
  bookmark: LinkBookmark;
  prefs: LinkCardPrefs;
  bulkMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onTagClick: (tag: string) => void;
  onView: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleUnread: () => void;
  onToggleShared: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(prefs.permanentNotes);
  const date = prefs.absoluteTime
    ? formatLinksAbsolute(bookmark.date_added)
    : formatLinksRelative(bookmark.date_added);
  const tags = bookmark.tag_names ?? [];
  // Legacy linkding HTML imports packed notes onto the description behind a
  // "[linkding-notes]" marker. Strip it for display and fall back to the
  // embedded notes so the Notes toggle appears even when the stored notes
  // field is empty. Stored data is untouched.
  const { description: displayDescription, notes: embeddedNotes } = splitLinkdingNotes(bookmark.description ?? '');
  const effectiveNotes = (bookmark.notes ?? '').trim() || embeddedNotes;

  return (
    <div class={`links-item ${Number(bookmark.unread) === 1 ? 'unread' : ''}`}>
      {bulkMode ? (
        <input
          type="checkbox"
          aria-label={`Select bookmark ${bookmark.id}`}
          checked={selected}
          onChange={onToggle}
          class="links-item-check"
        />
      ) : null}
      {prefs.showFavicon && bookmark.favicon_url ? (
        <img src={bookmark.favicon_url} alt="" width={24} height={24} loading="lazy" style={{ marginTop: 2 }} />
      ) : null}
      <div class="links-item-body">
        <a
          href={bookmark.url}
          target={prefs.linkTarget || '_blank'}
          rel="noopener noreferrer"
          class="links-item-title"
        >
          {bookmark.title || bookmark.url}
        </a>
        {prefs.showDisplayUrl ? (
          <div class="links-item-url">{displayLinksUrl(bookmark.url)}</div>
        ) : null}
        {(tags.length > 0 || displayDescription) ? (
          <div class="links-item-desc">
            {tags.map((tagName, i) => (
              <span key={tagName}>
                {i > 0 ? ' ' : null}
                <button type="button" class="taglink" onClick={() => onTagClick(tagName)}>
                  #{tagName}
                </button>
              </span>
            ))}
            {tags.length > 0 && displayDescription ? <span> | </span> : null}
            {displayDescription ? <span>{displayDescription}</span> : null}
          </div>
        ) : null}
        {notesOpen || prefs.permanentNotes ? (
          effectiveNotes ? (
            <div
              class="links-notes"
              dangerouslySetInnerHTML={{ __html: renderLinksMarkdown(effectiveNotes) }}
            />
          ) : (
            <div class="links-notes links-notes-empty">No notes yet.</div>
          )
        ) : null}
        <div class="links-actions">
          {bookmark.web_archive_snapshot_url ? (
            <a
              class="links-date"
              href={bookmark.web_archive_snapshot_url}
              target="_blank"
              rel="noreferrer"
              title={formatLinksAbsolute(bookmark.date_added)}
            >
              {date}
            </a>
          ) : (
            <span class="links-date" title={formatLinksAbsolute(bookmark.date_added)}>{date}</span>
          )}
          <span class="links-sep" aria-hidden="true">|</span>
          <button type="button" class="links-action" onClick={onView}>View</button>
          <button type="button" class="links-action" onClick={onEdit}>Edit</button>
          <button type="button" class="links-action" onClick={onArchive}>
            {bookmark.is_archived ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" class="links-action danger" onClick={onDelete}>Remove</button>
          {bookmark.unread ? (
            <button type="button" class="links-action" onClick={onToggleUnread}>Mark read</button>
          ) : null}
          {bookmark.shared ? (
            <button type="button" class="links-action" onClick={onToggleShared}>Unshare</button>
          ) : null}
          {!prefs.permanentNotes ? (
            <>
              <span class="links-sep" aria-hidden="true">|</span>
              <button type="button" class="links-action" onClick={() => setNotesOpen((v) => !v)}>
                {notesOpen ? 'Hide notes' : 'Notes'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
