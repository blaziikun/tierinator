// src/features/templates/template-link.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Template links: /?template=planets (the "Rank these" button on /t/planets/) opens
//  that template as a new list at start-up, as its gallery card would, without the start
//  screen. A broken or unknown id leaves a normal start and a toast saying why.
// ─────────────────────────────────────────────────────────────────────────────
import { currentListMeta } from '../../core/state';
import { isTemplateId } from '../../core/template-format';
import { byId } from '../../lib/dom';
import { toast } from '../../lib/ui';
import { syncStartScreen } from '../start/start';
import { TEMPLATE_PARAMETER } from './template-addresses';

/** Takes the template parameter out of the address, so a reload or a bookmark opens the list rather than a second copy. */
function forgetTemplateInAddressBar(): void {
    const parameters = new URLSearchParams(location.search);
    parameters.delete(TEMPLATE_PARAMETER);
    const rest = parameters.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
}

/** Opens the template a link names, if it names one. Runs at start-up, after a share link (which wins). */
export async function openTemplateLinkIfAny(): Promise<void> {
    const parameters = new URLSearchParams(location.search);
    if (!parameters.has(TEMPLATE_PARAMETER)) return;
    const id = parameters.get(TEMPLATE_PARAMETER);
    forgetTemplateInAddressBar();
    if (currentListMeta()?.preview) return; // a share link is open as a preview: that's what the link was for
    if (!isTemplateId(id)) {
        toast('That template link is broken. Pick a template from Browse templates instead.', 5000);
        return;
    }
    byId('start').classList.add('hid'); // not shown for the moment the template takes to load
    const { openLinkedTemplate } = await import('./templates');
    if (!(await openLinkedTemplate(id))) syncStartScreen();
}
