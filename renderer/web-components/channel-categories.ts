export enum ChannelCategory {
    ALL = 'all',
    KIDS = 'kids',
    NEWS = 'news',
    SPORTS = 'sports',
    MOVIES = 'movies',
    SERIES = 'series',
    DOCUMENTARY = 'documentary',
    MUSIC = 'music',
    LIFESTYLE = 'lifestyle',
    ENTERTAINMENT = 'entertainment',
    OTHER = 'other'
}

export const CategoryLabels: Record<ChannelCategory, string> = {
    [ChannelCategory.ALL]: 'All Channels',
    [ChannelCategory.KIDS]: 'Kids',
    [ChannelCategory.NEWS]: 'News',
    [ChannelCategory.SPORTS]: 'Sports',
    [ChannelCategory.MOVIES]: 'Movies',
    [ChannelCategory.SERIES]: 'Series & Drama',
    [ChannelCategory.DOCUMENTARY]: 'Science & History',
    [ChannelCategory.MUSIC]: 'Music',
    [ChannelCategory.LIFESTYLE]: 'Lifestyle & Food',
    [ChannelCategory.ENTERTAINMENT]: 'Entertainment',
    [ChannelCategory.OTHER]: 'Other'
};

export const CategoryIcons: Record<ChannelCategory, string> = {
    [ChannelCategory.ALL]: '📺',
    [ChannelCategory.KIDS]: '🧒',
    [ChannelCategory.NEWS]: '📰',
    [ChannelCategory.SPORTS]: '⚽',
    [ChannelCategory.MOVIES]: '🎬',
    [ChannelCategory.SERIES]: '🎭',
    [ChannelCategory.DOCUMENTARY]: '🔬',
    [ChannelCategory.MUSIC]: '🎵',
    [ChannelCategory.LIFESTYLE]: '🍳',
    [ChannelCategory.ENTERTAINMENT]: '🎉',
    [ChannelCategory.OTHER]: '📡'
};

interface CategoryPattern {
    category: ChannelCategory;
    pattern: RegExp;
}

const categoryPatterns: CategoryPattern[] = [
    {
        category: ChannelCategory.KIDS,
        pattern: /\b(KIDS|BABY|CHILD|YALDUTI|JOUNIR|JUNIOR|DISNEY|NICK|NICKELODEON|TEENNICK|CARTOON|TOON|ZOOM\s*TOON|YOYO|PELE|LOGI|JIJI|CHILDISH|CH\s*KIDS|YLD|MEZOO|WIZ|HOP)\b/i
    },
    {
        category: ChannelCategory.NEWS,
        pattern: /\b(NEWS|CNN|I24|24|23|14|13|12|11|KNESET|KNSSET|KNSEET|MAKAN|CHANNEL\s*\d+)\b/i
    },
    {
        category: ChannelCategory.SPORTS,
        pattern: /\b(SPORT|SPORTS|EUROSPORT|SUPER\s*LEAGUE|ONE\s*[12]?|5\s*(PLUS|GOLD|LIVE|STARS)?|VAMOS)\b/i
    },
    {
        category: ChannelCategory.MOVIES,
        pattern: /\b(MOVIE|MOVIES|CINEMA|HBO|ACTION\s*WORLD|КИНOМАРАФОН|HORROR|ROMANTIC|SAVRI)\b/i
    },
    {
        category: ChannelCategory.SERIES,
        pattern: /\b(SERIES|DRAMA|TURKISH|SPANISH|TELENOVELA|ISTANBUL|VIVA|INDIAN\s*SERIES|TV\s*(ACTION|COMEDY|DRAMA)|YAM\s*TICHONI)\b/i
    },
    {
        category: ChannelCategory.DOCUMENTARY,
        pattern: /\b(DOCU|DOCUMENTARY|HISTORY|NAT\s*GEO|NATIONAL\s*GEOGRAPHIC|DISCOVERY|ANIMAL\s*PLANET|WILD|SCIENCE|ID|DISC\s*SCIENCE|ONE\s*DOCO|ONE\s*EDGE)\b/i
    },
    {
        category: ChannelCategory.MUSIC,
        pattern: /\b(MUSIC|MTV|MAD\s*WORLD|KARAOKE|EGO|98)\b/i
    },
    {
        category: ChannelCategory.LIFESTYLE,
        pattern: /\b(FOOD|FOODY|FODDY|COOKING|LIFESTYLE|TRAVEL|HEALTH|TLC|STYLE|HOME\s*\+|GOODLIFE|NOFESH|SHOPPING|REALITY|HATUNAMI)\b/i
    },
    {
        category: ChannelCategory.ENTERTAINMENT,
        pattern: /\b(ENTERTAINMENT|COMEDY|COMDEY|E!|HUMOR|BIDUR|LOVE\s*ISLAND|BIG\s*BROTHER|NEXT\s*STAR|EREZ\s*NEHEDERET|FOMO|A\s*PLUS|A\+|BOLLYWOOD|BOLLYSHOW|NETFLIX|WALLA|STAR|SENIOR|RELEVENT|DAYSTAR|ZONE|REAL|LILUI|PLUS|DIAMONDS|POP\s*UP)\b/i
    }
];

export function categorizeChannel(channelName: string): ChannelCategory {
    for (const {category, pattern} of categoryPatterns) {
        if (pattern.test(channelName)) {
            return category;
        }
    }
    return ChannelCategory.OTHER;
}

export function filterChannelsByCategory(channels: any[], category: ChannelCategory): any[] {
    if (category === ChannelCategory.ALL) {
        return channels;
    }
    return channels.filter(channel => categorizeChannel(channel.name) === category);
}

export function getChannelCategories(): ChannelCategory[] {
    return Object.values(ChannelCategory);
}

export function extractCleanChannelName(name: string): string {
    let clean = name
        .replace(/^(IL|US|UK|FR|DE|ES):\s*/i, '')
        .replace(/^(PARTNER\s*TV|FREE\s*TV|SCREEN\s*TV|CELLCOM\s*TV|YES|HOT)\s*/i, '')
        .replace(/\s*(ᴴᴰ|HD|4K|ᵁᴴᴰ|UHD|◉)\s*/g, '')
        .replace(/\s*(TO\s*GO|CHANNEL)\s*/gi, '')
        .trim();
    
    if (clean.match(/^\d+$/)) {
        return `Channel ${clean}`;
    }
    
    return clean || name;
}
