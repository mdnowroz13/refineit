import figlet from 'figlet';
import gradient from 'gradient-string';
export function showBanner() {
    console.clear();
    const art = figlet.textSync('RefineIt', {
        font: 'Slant',
        horizontalLayout: 'default',
        verticalLayout: 'default',
    });
    console.log(gradient.pastel.multiline(art));
    console.log(gradient.passion('   The Ultimate Code Refactoring Engine'));
    console.log('\n');
}
export async function typeWriter(text, speed = 15) {
    for (const char of text) {
        process.stdout.write(gradient.cristal(char));
        await new Promise(r => setTimeout(r, speed));
    }
    console.log('');
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
//# sourceMappingURL=art.js.map