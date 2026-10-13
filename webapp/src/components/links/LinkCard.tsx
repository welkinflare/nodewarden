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

export function LinkCard({
  bookmark,
  prefs,
  selected,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
  onToggleUnread,
  onToggleShared,
}: {
  bookmark: LinkBookmark;
  prefs: LinkCardPrefs;
  selected: boolean;
  onToggle: () => void;
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

  return (
    <article class="rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label={`Select bookmark ${bookmark.id}`}
          checked={selected}
          onChange={onToggle}
          class="mt-1"
        />
        {prefs.showFavicon && bookmark.favicon_url ? (
          <img src={bookmark.favicon_url} alt="" class="mt-1 h-4 w-4" loading="lazy" />
        ) : null}
        <div class="min-w-0 flex-1">
          <a
            href={bookmark.url}
            target={prefs.linkTarget || '_blank'}
            rel="noopener noreferrer"
            class="break-words font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            {bookmark.title || bookmark.url}
          </a>
          {prefs.showDisplayUrl ? (
            <div class="truncate text-xs text-gray-500">{displayLinksUrl(bookmark.url)}</div>
          ) : null}
          {bookmark.description ? (
            <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">{bookmark.description}</p>
          ) : null}
          {bookmark.notes ? (
            notesOpen ? (
              <div
                class="markdown-body mt-1 text-sm"
                dangerouslySetInnerHTML={{ __html: renderLinksMarkdown(bookmark.notes) }}
              />
            ) : (
              <button class="mt-1 text-xs text-blue-600 underline" onClick={() => setNotesOpen(true)}>
                Show notes
              </button>
            )
          ) : null}
          <div class="mt-1 flex flex-wrap gap-1">
            {(bookmark.tag_names ?? []).map((tagName) => (
              <span
                key={tagName}
                class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                #{tagName}
              </span>
            ))}
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span title={formatLinksAbsolute(bookmark.date_added)}>{date}</span>
            {bookmark.unread ? <span class="font-semibold">unread</span> : null}
            {bookmark.is_archived ? <span>archived</span> : null}
            {bookmark.shared ? <span>shared</span> : null}
            {bookmark.web_archive_snapshot_url ? (
              <a href={bookmark.web_archive_snapshot_url} target="_blank" rel="noreferrer" class="underline">
                archive.org
              </a>
            ) : null}
          </div>
          <div class="mt-2 flex flex-wrap gap-1 text-xs">
            <button class="rounded border px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onEdit}>Edit</button>
            <button class="rounded border px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onArchive}>
              {bookmark.is_archived ? 'Unarchive' : 'Archive'}
            </button>
            <button class="rounded border px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onToggleUnread}>
              {bookmark.unread ? 'Mark read' : 'Mark unread'}
            </button>
            <button class="rounded border px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onToggleShared}>
              {bookmark.shared ? 'Unshare' : 'Share'}
            </button>
            <button
              class="rounded border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
