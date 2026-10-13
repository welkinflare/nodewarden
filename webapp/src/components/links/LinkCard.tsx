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
        <div class="links-meta">
          <span title={formatLinksAbsolute(bookmark.date_added)}>{date}</span>
          {bookmark.unread ? <span>· unread</span> : null}
          {bookmark.is_archived ? <span>· archived</span> : null}
          {bookmark.shared ? <span>· shared</span> : null}
          {bookmark.web_archive_snapshot_url ? (
            <span>· <a href={bookmark.web_archive_snapshot_url} target="_blank" rel="noreferrer">archive.org</a></span>
          ) : null}
        </div>
        <div class="links-actions">
          {bookmark.notes && !prefs.permanentNotes ? (
            <button type="button" class="links-action" onClick={() => setNotesOpen((v) => !v)}>
              {notesOpen ? 'Hide' : 'View'}
            </button>
          ) : null}
          <button type="button" class="links-action" onClick={onEdit}>Edit</button>
          <button type="button" class="links-action" onClick={onArchive}>
            {bookmark.is_archived ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" class="links-action" onClick={onToggleUnread}>
            {bookmark.unread ? 'Mark read' : 'Mark unread'}
          </button>
          <button type="button" class="links-action" onClick={onToggleShared}>
            {bookmark.shared ? 'Unshare' : 'Share'}
          </button>
          <button type="button" class="links-action danger" onClick={onDelete}>Remove</button>
        </div>
      </div>
    </div>
  );
}
