import { format, isAfter, isThisWeek, isThisYear, isToday, isYesterday, subDays } from 'date-fns';
import type { ChatHistoryItem } from '~/lib/persistence';

type Bin = { category: string; items: ChatHistoryItem[] };

/**
 * Split a list into its pinned conversations and the rest.
 *
 * Pinned items are lifted out of the ordering entirely and held at the top —
 * left in place they'd still be buried under everything newer, which defeats
 * the point of pinning.
 *
 * Generic so callers keep whatever they put in: the drawer's rows carry a
 * `status` the plain history item does not have.
 */
export function partitionPinned<T extends ChatHistoryItem>(list: T[]) {
  const pinned = list
    .filter((item) => item.pinned)
    .toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return { pinned, rest: list.filter((item) => !item.pinned) };
}

export function binDates(_list: ChatHistoryItem[]) {
  const list = _list.toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const binLookup: Record<string, Bin> = {};
  const bins: Array<Bin> = [];

  list.forEach((item) => {
    const category = dateCategory(new Date(item.timestamp));

    if (!(category in binLookup)) {
      const bin = {
        category,
        items: [item],
      };

      binLookup[category] = bin;

      bins.push(bin);
    } else {
      binLookup[category].items.push(item);
    }
  });

  return bins;
}

function dateCategory(date: Date) {
  if (isToday(date)) {
    return 'Today';
  }

  if (isYesterday(date)) {
    return 'Yesterday';
  }

  if (isThisWeek(date)) {
    // e.g., "Mon" instead of "Monday"
    return format(date, 'EEE');
  }

  const thirtyDaysAgo = subDays(new Date(), 30);

  if (isAfter(date, thirtyDaysAgo)) {
    return 'Past 30 Days';
  }

  if (isThisYear(date)) {
    // e.g., "Jan" instead of "January"
    return format(date, 'LLL');
  }

  // e.g., "Jan 2023" instead of "January 2023"
  return format(date, 'LLL yyyy');
}
