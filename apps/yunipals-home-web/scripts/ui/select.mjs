/** Choose a shared Select option through its visible, accessible menu. */
export async function chooseSelect(page, control, value) {
  await control.click();
  await page
    .locator(`[role="option"][data-select-value=${JSON.stringify(value)}]`)
    .click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
}
