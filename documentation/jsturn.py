"""
we have many button =>set a name , we will use name in python to explain what i wannt do
是否登入了 = logined
開始檢查(I) =cheak
導覽頁 = bar
新亂序(S) = new_case
開始/停止(Space) = playing
匯出csv = csv
首頁按鈕(顯示文字:timer) = home
登入按鈕 = login
登出按鈕 = logout
更多(三條線的圖形) = more
清除紀錄 = delete
紀錄時間 =time
該function 執行x秒 = use_time(x)
停止目標button在做的事情=stop(x)
全螢幕開始/結束 = full
開始按鈕裡面包含的文字(那個google圖我很喜歡，請留下來) = login_button_looks
button 是否正在被按著 = touching(x)
按鈕被按下的時間 = touchtime(x)
該 button 的任務是否還沒完成(function 還沒 return 或 跑完) = running
用戶設定 = user_setting
記分板 = score_board
there is one speacial function , it will return this funcion touched
touched
there are two speacial function, it will return Yes or No(1 or 0) if 長按  if 短按 .長按means one second at least , and then 手離開
long
short
we also have some imformation , like 
colar that may be used = colar
if now full mode = full_mode
history = hastory
cheak_time = cheak_time
user_playing_time = playing_time
the colar to show on user_playing_time = playing_time_colar
if start button touch, we need to know its mean user start to play or user played, he want save his playing time = start_or_end

"""
#init system variable
more_bar=["user_setting","score_board"]
origin_login_button_looks="使用 Google 帳戶登入"
login_button_looks="使用 Google 帳戶登入"
logined=0
original_bar=["home","login","we_put_nothing_here(其他按鈕還是要在同樣位置)","more",]
bar=original_bar.copy()#in python tkinger , we can design table.  i wanna design a table, each bar list value as a table column.
full_mode=0
cheaktime=15
playing_time=0# ui design: time show at most to .2f ,not .3f  / if 0.014 then 0.01 . if 0.015 then 0.02 
colar=["white","orange","red","green"]
playing_time_colar=colar[0]
history=[]
start_or_end=0#get this variable, process , change data in the variable

def touchtime(x):
    return f"{x} function be touch at {touchtime} second"

def touching(x):
    return f"if {x} function be touching now"
def running(x,y):
    if "no argument y":
        return f"if any {x}  function running (which mean do not return or finish) (yes=1)(no=0)"
    else:
        return f"if {x} function with {y} argument still running"
def stop(x,y):
    if "dont input y":
        return f"stoped any argument {y} with button {x}"
    else:
        return f"stoped button {x} with argument {y}"
def time(x):
    while True:
        usetime(0.001)
        x+=0.001
        if "code call stop(time())":
            break
    return "what time count"
def usetime(x):
    return f"this function waste {x} second"
def touched(ob):
    if "user dont input ob":
        return "wrong"
    return "if this button touched"

def button_touch_time():
    #單位 0.01 second
    return 1
def long(x,y=1):
    if f"{x} function touched at least {y} second":
        return 1
def short(x,y=1):
    if f"{x} function touched short than {y} second":
        return 1

#init button
def score_board():
    if touched(score_board):
        print("go to score_board page, it will still show bar, but it will show different ui")
        print("i'll set google sheet to erveryone readable, we use js to get score of google sheet, do not use google cloud bot.")

def user_setting():
    if touched(user_setting):
        print("go to user_setting page, like YouTube, if you touch video, it will show different ui")
        print("bar still show home, login, more, but it will show different ui")
        print("setting include 檢查時間 主題 nickname")#nickname 會上傳到google sheet,其他的留在本地 #主題我發現你有寫下拉選單 請讓選單的顏色和背景色一致(當然選單的文字也是)
def more():
    if touched(more):
        print(f"show row table of {more_bar}")
        return "more"

def logout():
    global logined
    if touched(logout):
        #"if logined==1:" this not be need. if logined=0 ,then it will not show logout button
        logined=0
        bar=["home","login","we_put_nothing_here(其他按鈕還是要在同樣位置)","more",]
        return "logout"

def login():
    global logined
    if touched(login):
        logined=1#user may switch his google account.
        bar=["home","login","logout","more",]
        return "logined"

def home():
    global logined
    if touched(home):
        print("do reset page to original page")
        if logined:
            bar=["home","login","logout","more",]
        else:
            bar=["home","login","we_put_nothing_here(其他按鈕還是要在同樣位置)","more",]

def new_case():
    global playing_time_colar, colar , full_mode
    stop(time)
    stop(cheak)
    playing_time_colar=colar[0]
    full_mode=0
    if running(full):
        stop(full)
        
    return "give new case"
def csv():
    return "get data from history variable, csv downloaded"
def delete():
    global history
    history=[]#no data internal

def cheak():
    if touched(cheak):
        global cheaktime, full_mode ,playing_time_colar
        playing_time_colar=[1]
        full_mode=1
        #it was touch once beacuse 'touched(cheak)' return 1 so 'if touched(cheak)' run
        if touchtime(cheak)>=1:
            #now touch second time
            #and touchtime at least 1 second
            playing_time_colar=colar[0]
            stop(playing)
        full()
        cheaktime=15
        while cheaktime>0:
            usetime(1)
            cheaktime-=1
        #now cheaktime=0
        playing_time_colar=colar[0]
        stop(playing)
    else:
        return "this button did not be touch"
def full():
    global full_mode
    if full_mode:
        #imagine full mean a big button, this button work space is "any thingin the website but not button"
        if touched(full):
            playing()#touched(playing) will return 1 in this row
            return "if full touched, it means playing button touched"
        else:
            return "this button did not be touch"
    else:
        return "now is not full mode"

def playing():
    global start_or_end,full_mode ,playing_time_colar,colar,history
    if touched(playing):
        
        if start_or_end==0:
            while not touching(playing):
                if running(cheak):
                    playing_time_colar=colar[1]
                else:
                    #if not runnning cheak
                    playing_time_colar=colar[0]
            while touching(playing):
                playing_time_colar=colar[2]
            if long(playing,0.55):
                
                stop(cheak)
                #now start
                time(playing_time)
                start_or_end==1
        else:
            #start_or_end==1
            #new end
            stop(time,playing_time)
            start_or_end==0
            full_mode=0
            history.append(playing_time)
            
    else:
        return "this button did not be touch"
 