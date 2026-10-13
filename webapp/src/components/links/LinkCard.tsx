import { useState } from 'preact/hooks';
import type { LinkBookmark } from '@/lib/api/links';
import { renderLinksMarkdown } from '@/lib/links-markdown';
import { displayLinksUrl, formatLinksAbsolute, formatLinksRelative } from '@/lib/links-utils';

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

  return (
    <div class="links-item">
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
        <img src={bookmark.favicon_url} alt="" width={16} height={16} loading="lazy" style={{ marginTop: 2 }} />
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
        {(tags.length > 0 || bookmark.description) ? (
          <div class="links-item-desc">
            {tags.map((tagName, i) => (
              <span key={tagName}>
                {i > 0 ? ' ' : null}
                <button type="button" class="taglink" onClick={() => onTagClick(tagName)}>
                  #{tagName}
                </button>
              </span>
            ))}
            {tags.length > 0 && bookmark.description ? <span> | </span> : null}
            {bookmark.description ? <span>{bookmark.description}</span> : null}
          </div>
        ) : null}
        {bookmark.notes && (notesOpen || prefs.permanentNotes) ? (
          <div
            class="links-notes"
            dangerouslySetInnerHTML={{ __html: renderLinksMarkdown(bookmark.notes) }}
          />
        ) : null}
        <div class="links-actions">
          <span class="links-date" title={formatLinksAbsolute(bookmark.date_added)}>{date}</span>
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
          {bookmark.notes && !prefs.permanentNotes ? (
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
