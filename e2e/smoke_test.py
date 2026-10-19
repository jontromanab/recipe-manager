"""Browser smoke test against a running stack (docker compose up).

Run: see README "Browser smoke test". Saves screenshots to /out.
Note: it creates and deletes a recipe and edits one, so run it on demo data.
"""

from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:8080"
OUT = "/out"
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    ctx.set_default_timeout(8000)
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    expect(page.locator(".card")).to_have_count(4)
    expect(page.locator(".brand")).to_contain_text("Bistro Verde")
    page.screenshot(path=f"{OUT}/list.png")

    # search by ingredient (debounced)
    page.fill(".search", "rosemary")
    expect(page.locator(".card")).to_have_count(1)
    expect(page.locator(".card h2")).to_have_text("Rosemary Focaccia")
    page.fill(".search", "")
    expect(page.locator(".card")).to_have_count(4)

    # tag filter
    page.locator(".card .tag", has_text="pastry").first.click()
    expect(page.locator(".card")).to_have_count(2)
    page.click("text=clear")

    # cook mode + scaling
    page.click("text=Braised Short Ribs")
    expect(page.locator("h1")).to_have_text("Braised Short Ribs")
    page.click(".scale button:has-text('2×')")
    expect(page.locator(".ingredient .amount").first).to_have_text("10 kg")
    expect(page.locator(".yield")).to_contain_text("20 portion")
    page.locator(".ingredient").nth(1).click()
    page.click("text=Next step →")
    page.click("text=Next step →")
    page.screenshot(path=f"{OUT}/cook-mode.png", full_page=True)

    # edit page + conflict: two tabs edit the same recipe
    page.click(".actions a:has-text('Edit')")
    expect(page.locator("h1")).to_have_text("Edit recipe")
    url = page.url
    other = ctx.new_page()
    other.goto(url)
    other.fill("label:has-text('Title') input", "Braised Short Ribs (v2)")
    other.click("text=Save recipe")
    expect(other.locator("h1")).to_have_text("Braised Short Ribs (v2)")
    page.fill("label:has-text('Title') input", "My edit")
    page.click("text=Save recipe")
    expect(page.locator(".banner.warn")).to_be_visible()
    page.wait_for_function("window.scrollY === 0")
    expect(page.locator(".banner.warn")).to_be_in_viewport()
    page.screenshot(path=f"{OUT}/conflict.png")
    page.click("text=Load their version")
    expect(page.locator("label:has-text('Title') input")).to_have_value("Braised Short Ribs (v2)")
    # put title back
    page.fill("label:has-text('Title') input", "Braised Short Ribs")
    page.click("text=Save recipe")
    expect(page.locator("h1")).to_have_text("Braised Short Ribs")

    # validation error shown
    page.goto(f"{BASE}/recipes/new")
    page.click("text=Save recipe")
    expect(page.locator(".error")).to_contain_text("title")
    page.screenshot(path=f"{OUT}/validation.png")

    # create, delete, undo
    page.fill("label:has-text('Title') input", "Staff Meal Rice")
    page.fill("label:has-text('Unit') input >> nth=0", "hotel pan")
    page.fill("[aria-label=Quantity]", "2")
    page.fill("[aria-label=Unit]", "kg")
    page.fill("[aria-label=Ingredient]", "jasmine rice")
    page.fill("[aria-label='Step 1']", "Rinse and steam 25 minutes.")
    page.click("text=Save recipe")
    expect(page.locator("h1")).to_have_text("Staff Meal Rice")
    page.click("button.danger")
    expect(page.locator(".banner")).to_contain_text("Deleted")
    expect(page.locator(".card")).to_have_count(4)
    page.click("text=Undo")
    expect(page.locator("h1")).to_have_text("Staff Meal Rice")
    page.click("button.danger")  # clean up
    expect(page.locator(".card")).to_have_count(4)

    # switch user: other org, viewer has no edit controls
    page.select_option(".signin select", "harbor-viewer")
    expect(page.locator(".brand")).to_contain_text("Harbor Grill")
    expect(page.locator(".card")).to_have_count(4)
    expect(page.locator("text=+ New recipe")).to_have_count(0)
    page.goto(f"{BASE}/recipes/1")
    expect(page.locator(".notice")).to_contain_text("Recipe not found")

    # phone width, dark mode
    m = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", device_scale_factor=2)
    mp = m.new_page()
    mp.goto(BASE)
    mp.click("text=Rosemary Focaccia")
    expect(mp.locator("h1")).to_contain_text("Focaccia")
    assert mp.evaluate("document.documentElement.scrollWidth") <= 390, "horizontal scroll on phone"
    mp.screenshot(path=f"{OUT}/phone-dark.png", full_page=True)
    b.close()

# 404s from the deliberate cross-org check are expected
unexpected = [e for e in errors if "404" not in e and "409" not in e and "422" not in e]
print("console errors:", unexpected or "none")
print("UI CHECK PASSED")
