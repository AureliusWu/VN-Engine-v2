# Minimal host hooks required by the Rain-compatible generated DSL.
define config.name = "VN Engine v2 RenPy Example"
define config.version = "0.1.0"
define config.save_directory = "vn-engine-v2-renpy-example"
define config.screen_width = 1280
define config.screen_height = 720
define h = Character("许澄")
define p = Character("我")

init python:
    renpy.music.register_channel("ambient", mixer="sfx", loop=True)

screen main_menu():
    tag menu
    frame:
        xalign 0.5
        yalign 0.5
        vbox:
            text "VN Engine v2 · Native RenPy"
            textbutton "Start" action Start()
            textbutton "Quit" action Quit(confirm=False)

screen say(who, what):
    window:
        id "window"
        xfill True
        yalign 1.0
        vbox:
            if who:
                text who id "who"
            text what id "what"

screen choice(items):
    vbox:
        xalign 0.5
        yalign 0.5
        for item in items:
            textbutton item.caption action item.action

screen ending_card(title):
    frame:
        xalign 0.5
        yalign 0.5
        vbox:
            text title
            textbutton "Continue" action Return()
