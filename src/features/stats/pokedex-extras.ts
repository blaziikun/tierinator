// src/features/stats/pokedex-extras.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Facts about every species (#1–1025) that the stats need but the Pokémon pack
//  doesn't carry: evolution stage, legendary group, body colour and base stat
//  total. Packed as one or two characters per species, in Pokédex order.
// ─────────────────────────────────────────────────────────────────────────────
import type { Entry } from '../../core/types';

const LAST_DEX = 1025;

const EXTRAS = {
    /** Evolution stage, one hex digit per species (index into STAGE_NAMES). */
    st: '23423423423423423424242424242342342424242323424242424242324234234234234242342424232242424242342242424242444224232202324242242200240024442242404000234002342342342424242442411112242344244423422422444242042242242424002232423224040244243201411104000234000234234234242323434234234242423424242342442342412240023424240000224242424024023424240000242424242424002423040124234244002342340000000000234234234234242423414242424424024242442424442412424111002341142424240241244444444444444444440000000000000000234234234242342424242424234242342424023423400234234242422342402424024242424242423423424234240242424024242342342423423424024024024230242400234240000000000002342342342423423424234242402423424242424242424242440002340242424240000002342342342342423424024240242424242424242340002424024000000002340000234400000000002400024234234234242342342424242424234244240241424242423423444444424002400002400002234000240000004444440234234234242424234242423402342442424242424240242424234240242400242402400044444000000000000234240000000000324000044000000',
    /** Legendary & special group, one digit per species (index into CATEGORY_NAMES). */
    ca: '11111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000555222671111111110000000000000000000000000000000000000000000000000000000000000000000000000000000000555222667111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002222225555566677111111111000000000000000000000000000000000000000000000002220000000000000000000000000000000000555665565777777111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000222005555566567771111111110000000000000000000000000000000000000000000002220000000006667771111111110000000000000000000000000000000000000000055000000002225555666644444446774444777111111111000000000000000000000000000000000000000000000000000000000000000000222666557555560000005111111111000000000000000000000000000000000000000000000000000000000000000000000333333333333222005555336633000555500333367',
    /** Pokédex body colour, one hex digit per species (index into BODY_COLOR_NAMES; 0 = unknown). */
    co: '5558882225593aa333733377aaaa222777663a6677228887733aaa2333322233344455522333aa66443339977777774aa88886a333367744623228837658a833822732a862233712aa22376555aaa22233338858722a66995596a522356527aa8227116412a47a746748a2133883364887411224839736a866a32545985555888222443989a75555333229a99922353934a3622a3246771444285aaa475578222a83173355552291a84288317544364511115292442222264629222232482285a8555333222333338822255224455aaa9336777777337144a77553661722212233772252229914642a8955273894198a6297391a22159a555888222333447755882266444112222244644322282a5a8485555533888588a811a22aa554444777555299996392499996aa444449222391155a992883a785588398338422299245529134a9755588822233888119339993399942333669922333322aa382265a477743333227728567333388822211133452798aa3322233556677116677759944331443284a695444a687229798915911447749a44555949222332272a833559955aa111555552337788327766666743997499a799427aa552529555287445a59154335416555888922449544aaa99a35555333882a51a344433a185535aa6669892244562299699426433a17644844842a54443a39385982255551115953a4227',
    /** Base stat total, two base-36 digits per species. */
    bs: '8ub9el8lb9eu8qb9eq5f5paz5f5paz6z9pdb71bh7aca80cg8wdh8cci7na5e17la5e18zdf8be17ic36tcn8wazdm7xb98hci7dbt82c88wdw8hcn9qff8cape68mb4dw8hb9e18caudm9beb8caudrbedw8rdm91cxah8md291d791dw8hel8mb9dwap94df91d796dm91eq8wbtcncnap9gdm9ldhcic3dm87c88wci9gegcsdwcndmdrdwdm5kf0ev8091elelelaz9vdr9vdrebf0g4g4g48cbogoiwgo8ub9el8lb9eu8qb9eq5zbj7ack7dau6yb4ev96cs5p625u6tb98wd27sa5e6dm6ybobedw6y9gcsa050btau5ubyelelb9dmc39cb9cn82cxbjbye68ccic8dwe1dwby96dw6yby6ycibe8cdc96dhcx96dwf096dwebcx6y5ucn8ha0a5dmf0g4g4g48cbegoiwiwgo8mb9eq8mb9eq8mb9ev64bo6obo5f5paz5pap649gdc649gdc7icn7ic85i7qee7hcm87cs7sc8im7eco6k6oa0dm6ld65aaf78b4akak96byeq7sbe87d7b9b9bybyb48ecz8hcsb4dw8hcsd296d2a0829geg9bd78mdmcqcqcscs80d08kd08cdw9vdr9vdr5kf0boc887cn87cncscncx788cdc82beeq9ldhdhdh968cbogo8cbogog4g4g4gogoimimiwgogo8ub9el8lb9eu8qb9eq6t9gdh6ybe5eao7ba3ej7seb9qdr9qdr68bsbs6sd6b996dr7nci91d7de9odu9qdcdre18mck7x95db8cdw828m64bfdh8cbegoau7xel96el96dw8cdmcm96cs9l9adqe6evebevevf0f0f5ebelele6eqeveeeleldcc8g4g4g4iwiwgoimiwg4dcgogogok0go8kbheo8kbmeo8kbheo73bo7naadw7tce8sdu8sdu8sdu84dj7c9ydk87dt7saueb8zbt94e4cd8hb9e186aoe5cxcx8makdw78a0dh7sdc7sdccs849ref8rdcct91dh9odkdm8fdf9vdrb5fr95d696e68cd282audm82aadm8hd58hazev9bd7bw8rdr86cw9bdcd28vd48hdl8cc8eg7nb9eb9bdh7naaeg8wbef08he1eb8hdrd39qe6dh8fdf9gdmdm9qe6aae6dgdg8cbogoa0fag4g4g4g4g4iwiwgoicg4gogo8pb9eq8jbdeu8qb9eq6lbr7qamdv5k5xbfa9e38fabfc9qer9odrd49vcy91cgdw9hcu9hdc80de8idw8wdq96dw81dda2eha2eheldwbzdw8cckgod28ld69bdq8gea6teviwiwgogogogo8wboeq8wboeq8wboeq7d9vdh71bm8cb4dw9edad88gcw7sdj4v8hdrapdw7hcm6ydc7xb98wdc9gdw5u82e6dhdmdm6eeq8wdcbeeufuc8dcdhc3d8d7dhed8cbogofufufufu5kb4iwiwfufufufufufufugogogobof0fufugo8cgo8mboeq8mboeq8mboeq7ncs6ta5dr509be16tcn6ycs7idm7wdh7idm6obee678dhdh8re6d77sdm6qdy8hel8mdc8ke47daae67daae6egc8e6e3egdf7idrd2c355d7d2d2d7c496dwe1e1e1e1ev7ibegoicicj6apfagog4g4g4g4dweldwfaeqe6e6g48mbeeq8mbfeq8mbeeq72dl5ub85uci6o9qdm8hd28od9789ue6bl7s9vdw73elel7kdr7sdm9ge182dh7ndc9bebci8gdi7id273dd89ake26tbtdh8rcp8cdwdxdc9qel82dkdw9aehdaeqd7evbyegegfafufufufufufufufufufufufu8wbrgo8cfafufufufugegeimimgegedh8ke4fffffffagof0gegegegecigo',
    /** Base stat totals of forms that differ from their species (form id → total). */
    fb: {
        10033: 625,
        10034: 634,
        10035: 634,
        10036: 630,
        10090: 495,
        10073: 579,
        10158: 430,
        10304: 585,
        10305: 585,
        10278: 583,
        10037: 600,
        10279: 590,
        10071: 590,
        10038: 600,
        10039: 590,
        10280: 620,
        10040: 600,
        10041: 640,
        10159: 435,
        10042: 615,
        10281: 700,
        10043: 780,
        10044: 780,
        10282: 625,
        10283: 630,
        10045: 610,
        10072: 610,
        10046: 600,
        10047: 600,
        10284: 565,
        10048: 600,
        10049: 700,
        10065: 630,
        10050: 630,
        10064: 635,
        10051: 618,
        10066: 480,
        10052: 480,
        10053: 630,
        10054: 510,
        10055: 575,
        10070: 560,
        10087: 560,
        10067: 590,
        10056: 555,
        10306: 555,
        10057: 565,
        10307: 565,
        10074: 580,
        10089: 700,
        10076: 700,
        10062: 700,
        10063: 700,
        10077: 770,
        10078: 770,
        10079: 780,
        10308: 585,
        10088: 580,
        10058: 700,
        10309: 700,
        10059: 625,
        10310: 625,
        10060: 594,
        10068: 618,
        10285: 580,
        10008: 520,
        10009: 520,
        10010: 520,
        10011: 520,
        10012: 520,
        10311: 700,
        10312: 700,
        10286: 628,
        10287: 608,
        10069: 545,
        10288: 585,
        10017: 540,
        10178: 540,
        10289: 588,
        10290: 615,
        10291: 620,
        10313: 583,
        10022: 700,
        10023: 700,
        10292: 630,
        10293: 634,
        10117: 640,
        10294: 630,
        10295: 607,
        10061: 551,
        10296: 651,
        10314: 566,
        10326: 566,
        10297: 582,
        10298: 600,
        10299: 594,
        10300: 600,
        10118: 486,
        10120: 708,
        10181: 486,
        10301: 778,
        10075: 700,
        10086: 680,
        10315: 578,
        10127: 620,
        10316: 630,
        10136: 500,
        10137: 500,
        10138: 500,
        10139: 500,
        10140: 500,
        10141: 500,
        10142: 500,
        10302: 585,
        10155: 680,
        10156: 680,
        10157: 754,
        10317: 700,
        10318: 700,
        10319: 700,
        10303: 570,
        10188: 700,
        10189: 700,
        10190: 1125,
        10193: 680,
        10194: 680,
        10272: 555,
        10320: 586,
        10256: 650,
        10321: 625,
        10322: 575,
        10323: 575,
        10324: 575,
        10325: 700,
        10276: 600,
        10277: 700,
    },
} as const;

type DigitTable = 'st' | 'ca' | 'co';

/** One species' digit from a table, or null for your own items and Pokémon past #1025. */
function digitOf(entry: Entry | null | undefined, table: DigitTable): number | null {
    if (!entry || entry.custom || !entry.dex || entry.dex > LAST_DEX) return null;
    return parseInt(EXTRAS[table][entry.dex - 1]!, 16);
}

export const STAGE_NAMES = ["Doesn't evolve", 'Baby', 'First stage', 'Middle stage', 'Final stage'] as const;
export const CATEGORY_NAMES = [
    'Regular',
    'Starter line',
    'Pseudo-legendary line',
    'Paradox',
    'Ultra Beast',
    'Legendary',
    'Box legend',
    'Mythical',
] as const;
export const BODY_COLOR_NAMES = ['', 'Black', 'Blue', 'Brown', 'Gray', 'Green', 'Pink', 'Purple', 'Red', 'White', 'Yellow'] as const;

export const evolutionStage = (entry: Entry | null | undefined): string | null => {
    const digit = digitOf(entry, 'st');
    return digit == null ? null : (STAGE_NAMES[digit] ?? null);
};

export const specialCategory = (entry: Entry | null | undefined): string | null => {
    const digit = digitOf(entry, 'ca');
    return digit == null ? null : (CATEGORY_NAMES[digit] ?? null);
};

/** The Pokédex colour, or null (also when unknown). */
export const bodyColor = (entry: Entry | null | undefined): string | null => BODY_COLOR_NAMES[digitOf(entry, 'co') ?? 0] || null;

export function baseStatTotal(entry: Entry | null | undefined): number | null {
    if (!entry || entry.custom || !entry.dex || entry.dex > LAST_DEX) return null;
    const formTotal = (EXTRAS.fb as Record<number, number>)[entry.id];
    if (formTotal != null) return formTotal;
    const start = (entry.dex - 1) * 2;
    return parseInt(EXTRAS.bs.slice(start, start + 2), 36);
}
